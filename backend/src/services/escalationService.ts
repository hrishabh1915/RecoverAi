// Human Escalation Service.
// Manages the Human Approval Queue for payments flagged by deterministic policy
// rules (e.g. High Value > ₹50k, Low AI Confidence, Unknown Declines).
// Handles operator approvals, rejections, execution guard checks, and audit logging.

import { prisma } from '../lib/prisma.js';
import {
  buildExecutionContext,
  updatePayment,
  createRecoveryAttempt,
  updateAttemptStatus,
  insertAuditLog,
} from '../repositories/index.js';

export interface PendingEscalationItem {
  decisionId: string;
  paymentId: string;
  customerId: string;
  externalCustomerId: string;
  gatewayPaymentId: string;
  amountINR: number;
  amountMinor: string;
  currency: string;
  paymentMethod: string;
  failureReason: string;
  policyRuleTriggered: string;
  reasonCode: string;
  reason: string;
  aiDiagnosis: string | null;
  aiConfidence: number | null;
  aiReasoningFactors: string[];
  evaluationTime: string;
}

export interface EscalationActionResponse {
  success: boolean;
  decisionId: string;
  paymentId: string;
  action: 'APPROVED' | 'REJECTED';
  status: 'RECOVERED' | 'RECOVERY_STOPPED' | 'ERROR';
  recoveredAmountINR?: number;
  message: string;
}

/**
 * Lists all transactions currently pending human review.
 */
export async function getPendingEscalations(
  merchantId?: string,
): Promise<PendingEscalationItem[]> {
  const whereClause: Record<string, unknown> = {
    policyDecision: 'HUMAN_APPROVAL_REQUIRED',
    payment: {
      status: 'FAILED',
    },
  };

  if (merchantId) {
    whereClause['payment'] = {
      ...((whereClause['payment'] as Record<string, unknown>) ?? {}),
      merchantId,
    };
  }

  const decisions = await prisma.recoveryDecision.findMany({
    where: whereClause,
    include: {
      payment: {
        include: {
          customer: { select: { externalCustomerId: true } },
        },
      },
    },
    orderBy: { evaluationTime: 'desc' },
  });

  return decisions.map((d) => {
    let aiReasoning: string[] = [];
    let aiDiag: string | null = null;
    let aiConf: number | null = null;

    if (d.aiResponse) {
      try {
        const parsed = JSON.parse(d.aiResponse);
        aiReasoning = parsed.reasoningFactors ?? [];
        aiDiag = parsed.diagnosis ?? null;
        aiConf = parsed.confidence ?? null;
      } catch {
        // keep defaults
      }
    }

    const amountMinorNum = Number(d.payment.amountMinor);

    // Parse rule name e.g. "Rule 11: HIGH_VALUE_REVIEW"
    const parts = d.policyRuleTriggered.split(': ');
    const reasonCode = parts[1] ?? d.policyRuleTriggered;

    return {
      decisionId: d.id,
      paymentId: d.payment.id,
      customerId: d.payment.customerId,
      externalCustomerId: d.payment.customer.externalCustomerId,
      gatewayPaymentId: d.payment.gatewayPaymentId,
      amountINR: amountMinorNum / 100,
      amountMinor: d.payment.amountMinor.toString(),
      currency: d.payment.currency,
      paymentMethod: d.payment.paymentMethod,
      failureReason: d.payment.failureReason ?? 'UNKNOWN',
      policyRuleTriggered: d.policyRuleTriggered,
      reasonCode,
      reason: `Requires human confirmation: ${reasonCode}`,
      aiDiagnosis: aiDiag,
      aiConfidence: aiConf,
      aiReasoningFactors: aiReasoning,
      evaluationTime: d.evaluationTime.toISOString(),
    };
  });
}

/**
 * Operator approves a pending escalation.
 * Passes through server-side Execution Guard, executes simulated recovery, and updates status.
 */
export async function approveEscalation(
  decisionId: string,
  operatorNotes = 'Approved by human operator after review',
): Promise<EscalationActionResponse> {
  const decision = await prisma.recoveryDecision.findUnique({
    where: { id: decisionId },
    include: { payment: true },
  });

  if (!decision) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  // 1. Fresh DB Execution Guard
  const execCtx = await buildExecutionContext(decision.paymentId);
  if (execCtx.paymentStatusAtExecution !== 'failed') {
    return {
      success: false,
      decisionId,
      paymentId: decision.paymentId,
      action: 'APPROVED',
      status: 'ERROR',
      message: `Execution Guard rejected: Payment is already in state '${execCtx.paymentStatusAtExecution}'.`,
    };
  }

  // 2. Create in-flight recovery attempt
  const attempt = await createRecoveryAttempt(decision.paymentId, 1, new Date());

  // 3. Mark attempt completed and update payment to RECOVERED
  await updateAttemptStatus(attempt.id, 'completed', new Date());
  await updatePayment(decision.paymentId, {
    status: 'recovered',
    recoveredAt: new Date().toISOString(),
  });

  const amountINR = Number(decision.payment.amountMinor) / 100;

  // 4. Record operator approval in append-only Audit Log
  await insertAuditLog({
    entityType: 'payment',
    entityId: decision.paymentId,
    action: 'ESCALATION_APPROVED',
    actor: 'human_operator',
    details: {
      decisionId,
      operatorNotes,
      rulePreviouslyTriggered: decision.policyRuleTriggered,
      amountINR,
      recoveredAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    decisionId,
    paymentId: decision.paymentId,
    action: 'APPROVED',
    status: 'RECOVERED',
    recoveredAmountINR: amountINR,
    message: `Payment ${decision.paymentId} approved by operator and successfully recovered for ₹${amountINR.toLocaleString('en-IN')}.`,
  };
}

/**
 * Operator rejects a pending escalation.
 * Confirms permanent stop, keeps payment as FAILED, and logs audit record.
 */
export async function rejectEscalation(
  decisionId: string,
  operatorNotes = 'Rejected by human operator: recovery not recommended',
): Promise<EscalationActionResponse> {
  const decision = await prisma.recoveryDecision.findUnique({
    where: { id: decisionId },
  });

  if (!decision) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  // Record operator rejection in append-only Audit Log
  await insertAuditLog({
    entityType: 'payment',
    entityId: decision.paymentId,
    action: 'ESCALATION_REJECTED',
    actor: 'human_operator',
    details: {
      decisionId,
      operatorNotes,
      rulePreviouslyTriggered: decision.policyRuleTriggered,
      stoppedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    decisionId,
    paymentId: decision.paymentId,
    action: 'REJECTED',
    status: 'RECOVERY_STOPPED',
    message: `Payment ${decision.paymentId} recovery permanently stopped by human operator.`,
  };
}
