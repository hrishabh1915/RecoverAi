// Audit Trail Service.
// Synthesizes the complete end-to-end lifecycle timeline for any payment:
// Ingestion → AI Diagnosis → Policy Decision → [Human Escalation] → Execution Guard → Recovery Result.

import { prisma } from '../lib/prisma.js';

export interface TimelineEvent {
  step: number;
  stage: 'INGESTION' | 'AI_DIAGNOSIS' | 'POLICY_EVALUATION' | 'HUMAN_REVIEW' | 'EXECUTION' | 'DISPOSITION';
  title: string;
  description: string;
  timestamp: string;
  badgeType: 'info' | 'success' | 'warning' | 'error';
  metadata: Record<string, unknown>;
}

export interface PaymentAuditTimeline {
  paymentId: string;
  gatewayPaymentId: string;
  merchantId: string;
  customerId: string;
  amountINR: number;
  currency: string;
  paymentMethod: string;
  currentStatus: string;
  failureReason: string | null;
  recoveredAt: string | null;
  timeline: TimelineEvent[];
}

export async function getPaymentAuditTimeline(
  paymentId: string,
): Promise<PaymentAuditTimeline | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      processedEvents: { orderBy: { eventReceivedAt: 'asc' } },
      recoveryDecisions: { orderBy: { evaluationTime: 'asc' } },
      recoveryAttempts: { orderBy: { startedAt: 'asc' } },
    },
  });

  if (!payment) return null;

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityId: paymentId },
    orderBy: { createdAt: 'asc' },
  });

  const timeline: TimelineEvent[] = [];
  let step = 1;

  // 1. Ingestion Events
  for (const ev of payment.processedEvents) {
    timeline.push({
      step: step++,
      stage: 'INGESTION',
      title: 'Payment Failure Inbound Event Ingested',
      description: `Webhook received with gateway event ${ev.gatewayEventId}. Idempotency verified.`,
      timestamp: ev.eventReceivedAt.toISOString(),
      badgeType: 'info',
      metadata: {
        gatewayEventId: ev.gatewayEventId,
        paymentMethod: payment.paymentMethod,
        declineCode: payment.failureReason ?? 'UNKNOWN',
      },
    });
  }

  // 2. AI Diagnosis & Policy Decisions
  for (const d of payment.recoveryDecisions) {
    let aiDiag = 'UNKNOWN';
    let aiConf = 0;
    let aiFactors: string[] = [];

    if (d.aiResponse) {
      try {
        const parsed = JSON.parse(d.aiResponse);
        aiDiag = parsed.diagnosis ?? 'UNKNOWN';
        aiConf = parsed.confidence ?? 0;
        aiFactors = parsed.reasoningFactors ?? [];
      } catch {
        // keep defaults
      }
    }

    timeline.push({
      step: step++,
      stage: 'AI_DIAGNOSIS',
      title: `AI Diagnosis: ${aiDiag} (${(aiConf * 100).toFixed(0)}% Confidence)`,
      description: aiFactors.join(' • ') || 'Diagnostic specialist evaluated failure taxonomy.',
      timestamp: d.evaluationTime.toISOString(),
      badgeType: d.aiValid ? 'info' : 'warning',
      metadata: {
        diagnosis: aiDiag,
        confidence: aiConf,
        aiValid: d.aiValid,
        recommendedAction: d.action,
      },
    });

    timeline.push({
      step: step++,
      stage: 'POLICY_EVALUATION',
      title: `Deterministic Policy Decision: ${d.policyDecision}`,
      description: `Triggered ${d.policyRuleTriggered}. Recovery score: ${d.recoveryScore ?? 'N/A'}/100.`,
      timestamp: d.evaluationTime.toISOString(),
      badgeType:
        d.policyDecision === 'ALLOW'
          ? 'success'
          : d.policyDecision === 'HUMAN_APPROVAL_REQUIRED'
          ? 'warning'
          : 'error',
      metadata: {
        decision: d.policyDecision,
        action: d.action,
        ruleTriggered: d.policyRuleTriggered,
        recoveryScore: d.recoveryScore,
      },
    });
  }

  // 3. Operator Human Escalation (from Audit Logs)
  const escalationLogs = auditLogs.filter(
    (l) => l.action === 'ESCALATION_APPROVED' || l.action === 'ESCALATION_REJECTED',
  );

  for (const log of escalationLogs) {
    let details: Record<string, unknown> = {};
    try {
      details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
    } catch {
      // keep
    }

    timeline.push({
      step: step++,
      stage: 'HUMAN_REVIEW',
      title: log.action === 'ESCALATION_APPROVED' ? 'Operator Approved Recovery' : 'Operator Rejected Recovery',
      description: (details['operatorNotes'] as string) ?? 'Decision recorded by human operator.',
      timestamp: log.createdAt.toISOString(),
      badgeType: log.action === 'ESCALATION_APPROVED' ? 'success' : 'error',
      metadata: {
        actor: log.actor,
        action: log.action,
        notes: details['operatorNotes'],
      },
    });
  }

  // 4. Execution Attempts
  for (const att of payment.recoveryAttempts) {
    timeline.push({
      step: step++,
      stage: 'EXECUTION',
      title: `Recovery Attempt #${att.retryCount} (${att.status.toUpperCase()})`,
      description:
        att.status === 'completed'
          ? 'Autonomous smart retry executed successfully. Funds captured.'
          : att.status === 'in_flight'
          ? 'Recovery attempt locked in-flight.'
          : 'Recovery attempt failed on rail switch.',
      timestamp: (att.completedAt ?? att.startedAt).toISOString(),
      badgeType: att.status === 'completed' ? 'success' : 'error',
      metadata: {
        attemptId: att.id,
        status: att.status,
        retryCount: att.retryCount,
      },
    });
  }

  // 5. Final Disposition
  const amountINR = Number(payment.amountMinor) / 100;
  timeline.push({
    step: step++,
    stage: 'DISPOSITION',
    title: payment.status === 'RECOVERED' ? `Revenue Recovered: ₹${amountINR.toLocaleString('en-IN')}` : 'Payment Failed / Stopped',
    description:
      payment.status === 'RECOVERED'
        ? `Successfully recovered ₹${amountINR.toLocaleString('en-IN')} on ${payment.paymentMethod.toUpperCase()} rail.`
        : 'Payment stopped by safety policy or operator.',
    timestamp: (payment.recoveredAt ?? payment.updatedAt).toISOString(),
    badgeType: payment.status === 'RECOVERED' ? 'success' : 'error',
    metadata: {
      status: payment.status,
      recoveredAmountINR: payment.status === 'RECOVERED' ? amountINR : 0,
    },
  });

  return {
    paymentId: payment.id,
    gatewayPaymentId: payment.gatewayPaymentId,
    merchantId: payment.merchantId,
    customerId: payment.customerId,
    amountINR,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod,
    currentStatus: payment.status,
    failureReason: payment.failureReason,
    recoveredAt: payment.recoveredAt ? payment.recoveredAt.toISOString() : null,
    timeline,
  };
}
