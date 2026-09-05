import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma.js';
import {
  getAllPayments,
  getPaymentById,
  getDecisionsForPayment,
  getAuditLogsForEntity,
  getAllAuditLogs,
} from './repositories/index.js';
import { processPaymentFailureEvent } from './services/recoveryPipeline.js';
import { processRazorpayWebhookEvent } from './services/razorpayWebhookService.js';
import { diagnosePaymentFailure } from './services/aiDiagnosisService.js';
import { processBatchRecovery } from './services/batchRecoveryService.js';
import {
  getPendingEscalations,
  approveEscalation,
  rejectEscalation,
} from './services/escalationService.js';
import { getPaymentAuditTimeline } from './services/auditTrailService.js';
import type { PaymentStatus } from './types/domain.js';
import { isPaymentStatus, isFailureReason, isPaymentMethod } from './types/domain.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' })); // Allow all origins for dev/demo
app.use(express.json());

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'RecoverAI Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Metrics & Dashboard Analytics ───────────────────────────────────────────
/**
 * GET /api/metrics
 * Returns aggregate recovery metrics, revenue recovered, and decision breakdowns.
 */
app.get('/api/metrics', async (_req, res) => {
  try {
    const allPayments = await prisma.payment.findMany({
      select: {
        status: true,
        amountMinor: true,
        failureReason: true,
        paymentMethod: true,
      },
    });

    let totalPayments = 0;
    let totalFailed = 0;
    let totalRecovered = 0;
    let atRiskMinor = BigInt(0);
    let recoveredMinor = BigInt(0);
    const failureReasonCounts: Record<string, number> = {};
    const paymentMethodCounts: Record<string, number> = {};

    for (const p of allPayments) {
      totalPayments++;
      const amount = BigInt(p.amountMinor);

      paymentMethodCounts[p.paymentMethod] = (paymentMethodCounts[p.paymentMethod] ?? 0) + 1;

      if (p.status === 'FAILED') {
        totalFailed++;
        atRiskMinor += amount;
        if (p.failureReason) {
          failureReasonCounts[p.failureReason] = (failureReasonCounts[p.failureReason] ?? 0) + 1;
        }
      } else if (p.status === 'RECOVERED') {
        totalRecovered++;
        recoveredMinor += amount;
      }
    }

    const decisions = await prisma.recoveryDecision.findMany({
      select: { policyDecision: true, action: true, policyRuleTriggered: true },
    });

    const stoppingReasonCounts: Record<string, number> = {};
    for (const d of decisions) {
      if (d.policyDecision === 'DENY' || d.policyDecision === 'HUMAN_APPROVAL_REQUIRED') {
        // e.g. "Rule 6: FRAUD_BLOCK" -> "FRAUD_BLOCK"
        const parts = d.policyRuleTriggered.split(': ');
        const reason = parts[1] ?? d.policyRuleTriggered;
        stoppingReasonCounts[reason] = (stoppingReasonCounts[reason] ?? 0) + 1;
      }
    }

    const decisionsBreakdown = {
      ALLOW: decisions.filter((d) => d.policyDecision === 'ALLOW').length,
      HUMAN_APPROVAL_REQUIRED: decisions.filter((d) => d.policyDecision === 'HUMAN_APPROVAL_REQUIRED').length,
      DENY: decisions.filter((d) => d.policyDecision === 'DENY').length,
    };

    const recoveryRate =
      totalFailed + totalRecovered > 0
        ? Math.round((totalRecovered / (totalFailed + totalRecovered)) * 100)
        : 0;

    res.json({
      metrics: {
        totalPayments,
        totalFailedPayments: totalFailed,
        totalRecoveredPayments: totalRecovered,
        atRiskRevenueINR: Number(atRiskMinor) / 100,
        simulatedRecoveredRevenueINR: Number(recoveredMinor) / 100,
        atRiskMinor: atRiskMinor.toString(),
        recoveredMinor: recoveredMinor.toString(),
        recoveryRatePercent: recoveryRate,
        isSimulatedData: true,
        simulatedDisclosure:
          'Demo Environment: All ₹ recovered figures are simulated using synthetic Razorpay-shaped event payloads. AI recommends; deterministic policy disposes.',
      },
      decisionsBreakdown,
      failureReasonCounts,
      paymentMethodCounts,
      stoppingReasonCounts,
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_METRICS', message: String(error) });
  }
});

// ── Inbound Webhook: Payment Failed Event ───────────────────────────────────
/**
 * POST /api/events/payment-failed
 * Inbound webhook from payment gateway on payment failure.
 * Pipeline: Idempotency → DB State → AI Diagnosis → Scoring → Deterministic Policy → Execution Guard → Audit Log
 */
app.post('/api/events/payment-failed', async (req, res) => {
  try {
    const { merchantId, gatewayEventId, paymentId, rawPayload, aiOverride } = req.body;

    if (!merchantId || !gatewayEventId || !paymentId) {
      res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'merchantId, gatewayEventId, and paymentId are required.',
      });
      return;
    }

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId,
      paymentId,
      rawPayload,
      aiOverride,
    });

    res.json(result);
  } catch (error) {
    console.error('Error processing payment failure event:', error);
    res.status(500).json({
      error: 'PIPELINE_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// ── Inbound Webhook: Razorpay Test Mode Webhook ──────────────────────────────
/**
 * POST /api/webhooks/razorpay
 * Inbound webhook adapter for Razorpay payment events.
 * Translates Razorpay payloads into RecoverAI schema and delegates to the central pipeline.
 */
app.post('/api/webhooks/razorpay', async (req, res) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const signatureHeader = req.headers['x-razorpay-signature'] as string | undefined;

    const result = await processRazorpayWebhookEvent(rawBody, req.body, signatureHeader);

    if (!result.success && result.message === 'Invalid Razorpay Webhook signature.') {
      res.status(401).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Error processing Razorpay webhook:', error);
    res.status(500).json({
      error: 'RAZORPAY_WEBHOOK_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// ── AI Diagnosis Testing API ────────────────────────────────────────────────
/**
 * POST /api/ai/diagnose
 * Diagnostic playground for testing AI failure classification with full schema validation.
 */
app.post('/api/ai/diagnose', async (req, res) => {
  try {
    const {
      failureReason,
      failureCode,
      errorMessage,
      paymentMethod,
      currency,
      customerRiskFlag,
      retryCount,
      rawMockOutput,
    } = req.body;

    const validatedFailureReason =
      typeof failureReason === 'string' && isFailureReason(failureReason)
        ? failureReason
        : 'UNKNOWN';
    const validatedPaymentMethod =
      typeof paymentMethod === 'string' && isPaymentMethod(paymentMethod)
        ? paymentMethod
        : 'card';

    const result = await diagnosePaymentFailure(
      {
        failureReason: validatedFailureReason,
        failureCode,
        errorMessage,
        paymentMethod: validatedPaymentMethod,
        currency: currency ?? 'INR',
        customerRiskFlag: Boolean(customerRiskFlag),
        retryCount: typeof retryCount === 'number' ? retryCount : 0,
      },
      rawMockOutput ? { rawMockOutput } : undefined,
    );

    res.json(result);
  } catch (error) {
    console.error('Error in AI diagnosis:', error);
    res.status(500).json({
      error: 'AI_DIAGNOSIS_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// ── Batch Recovery API ──────────────────────────────────────────────────────
/**
 * POST /api/recovery/batch
 * Triggers batch recovery across unrecovered failed payments.
 * Supports both dry-run simulation and live execution.
 */
app.post('/api/recovery/batch', async (req, res) => {
  try {
    const { merchantId, limit, dryRun, paymentIds } = req.body ?? {};

    const batchResult = await processBatchRecovery({
      merchantId,
      limit: typeof limit === 'number' ? limit : 50,
      dryRun: Boolean(dryRun),
      paymentIds: Array.isArray(paymentIds) ? paymentIds : undefined,
    });

    res.json({
      success: true,
      batch: batchResult,
    });
  } catch (error) {
    console.error('Error running batch recovery:', error);
    res.status(500).json({
      error: 'BATCH_RECOVERY_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/recovery/batch/summary
 * Returns current queue status of failed payments awaiting recovery.
 */
app.get('/api/recovery/batch/summary', async (_req, res) => {
  try {
    const failedPayments = await prisma.payment.findMany({
      where: { status: 'FAILED' },
      select: {
        id: true,
        amountMinor: true,
        failureReason: true,
        createdAt: true,
      },
    });

    let totalAtRiskMinor = BigInt(0);
    const failureReasonBreakdown: Record<string, number> = {};

    for (const p of failedPayments) {
      totalAtRiskMinor += BigInt(p.amountMinor);
      if (p.failureReason) {
        failureReasonBreakdown[p.failureReason] =
          (failureReasonBreakdown[p.failureReason] ?? 0) + 1;
      }
    }

    res.json({
      summary: {
        pendingFailedCount: failedPayments.length,
        totalAtRiskINR: Number(totalAtRiskMinor) / 100,
        totalAtRiskMinor: totalAtRiskMinor.toString(),
        failureReasonBreakdown,
        readyForBatchRecovery: failedPayments.length > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching batch summary:', error);
    res.status(500).json({
      error: 'FAILED_TO_FETCH_BATCH_SUMMARY',
      message: String(error),
    });
  }
});

// ── Payments API ────────────────────────────────────────────────────────────
/**
 * GET /api/payments
 * List payments with optional filters (merchantId, status, limit).
 */
app.get('/api/payments', async (req, res) => {
  try {
    const { merchantId, status, limit } = req.query;

    let validStatus: PaymentStatus | undefined;
    if (typeof status === 'string' && isPaymentStatus(status)) {
      validStatus = status;
    }

    const payments = await getAllPayments({
      merchantId: typeof merchantId === 'string' ? merchantId : undefined,
      status: validStatus,
      limit: limit ? parseInt(String(limit), 10) : 100,
    });

    // Serialize BigInt values as strings for JSON response
    const serialized = payments.map((p) => ({
      ...p,
      amountMinor: p.amountMinor.toString(),
      amountINR: Number(p.amountMinor) / 100,
    }));

    res.json({ payments: serialized, count: serialized.length });
  } catch (error) {
    console.error('Error listing payments:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_PAYMENTS', message: String(error) });
  }
});

/**
 * GET /api/payments/:id
 * Retrieve a single payment record by ID.
 */
app.get('/api/payments/:id', async (req, res) => {
  try {
    const payment = await getPaymentById(req.params.id);
    if (!payment) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Payment not found.' });
      return;
    }

    res.json({
      payment: {
        ...payment,
        amountMinor: payment.amountMinor.toString(),
        amountINR: Number(payment.amountMinor) / 100,
      },
    });
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_PAYMENT', message: String(error) });
  }
});

// ── Recovery Decisions API ──────────────────────────────────────────────────
/**
 * GET /api/recovery-decisions/:paymentId
 * Get all recovery decisions for a payment.
 */
app.get('/api/recovery-decisions/:paymentId', async (req, res) => {
  try {
    const decisions = await getDecisionsForPayment(req.params.paymentId);
    res.json({ decisions, count: decisions.length });
  } catch (error) {
    console.error('Error fetching recovery decisions:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_DECISIONS', message: String(error) });
  }
});

// ── Audit Logs API ──────────────────────────────────────────────────────────
/**
 * GET /api/audit-logs
 * GET /api/audit-logs/:entityId
 * Get audit log entries.
 */
app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const logs = await getAllAuditLogs(limit);
    res.json({ logs, count: logs.length });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_AUDIT_LOGS', message: String(error) });
  }
});

app.get('/api/audit-logs/:entityType/:entityId', async (req, res) => {
  try {
    const logs = await getAuditLogsForEntity(req.params.entityType, req.params.entityId);
    res.json({ logs, count: logs.length });
  } catch (error) {
    console.error('Error fetching entity audit logs:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_AUDIT_LOGS', message: String(error) });
  }
});

// ── Human Escalation API ────────────────────────────────────────────────────
/**
 * GET /api/escalations
 * List all payments currently pending operator approval.
 */
app.get('/api/escalations', async (req, res) => {
  try {
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const escalations = await getPendingEscalations(merchantId);
    res.json({ escalations, count: escalations.length });
  } catch (error) {
    console.error('Error listing escalations:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_ESCALATIONS', message: String(error) });
  }
});

/**
 * POST /api/escalations/:decisionId/approve
 * Human operator approves recovery.
 */
app.post('/api/escalations/:decisionId/approve', async (req, res) => {
  try {
    const { notes } = req.body ?? {};
    const result = await approveEscalation(req.params.decisionId, notes);
    res.json(result);
  } catch (error) {
    console.error('Error approving escalation:', error);
    res.status(500).json({ error: 'APPROVAL_ERROR', message: String(error) });
  }
});

/**
 * POST /api/escalations/:decisionId/reject
 * Human operator rejects recovery.
 */
app.post('/api/escalations/:decisionId/reject', async (req, res) => {
  try {
    const { notes } = req.body ?? {};
    const result = await rejectEscalation(req.params.decisionId, notes);
    res.json(result);
  } catch (error) {
    console.error('Error rejecting escalation:', error);
    res.status(500).json({ error: 'REJECTION_ERROR', message: String(error) });
  }
});

// ── Audit Trail Lifecycle Timeline API ──────────────────────────────────────
/**
 * GET /api/audit-trail/:paymentId
 * Returns synthesized chronological timeline for any transaction.
 */
app.get('/api/audit-trail/:paymentId', async (req, res) => {
  try {
    const timeline = await getPaymentAuditTimeline(req.params.paymentId);
    if (!timeline) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Payment not found.' });
      return;
    }
    res.json(timeline);
  } catch (error) {
    console.error('Error fetching audit timeline:', error);
    res.status(500).json({ error: 'FAILED_TO_FETCH_TIMELINE', message: String(error) });
  }
});

// ── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found.' });
});

// ── Start server if run directly ────────────────────────────────────────────
export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`\n🚀 RecoverAI Backend running at http://localhost:${port}`);
    console.log(`   Health check: http://localhost:${port}/health`);
    console.log(`   Metrics:      http://localhost:${port}/api/metrics\n`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
