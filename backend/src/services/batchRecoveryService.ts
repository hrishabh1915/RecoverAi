// Batch Recovery Engine.
// Processes batches of failed payments through the RecoverAI pipeline.
// Evaluates at-risk revenue, executes safe recoveries, stops when rules dictate,
// and measures simulated revenue recovered with complete itemized auditability.

import { prisma } from '../lib/prisma.js';
import {
  processPaymentFailureEvent,
  type PipelineResult,
} from './recoveryPipeline.js';
import { calculateRecoveryScore } from './scoreCalculator.js';
import { evaluatePolicy } from './policyEngine.js';
import { diagnosePaymentFailure } from './aiDiagnosisService.js';
import { getCustomerState } from '../repositories/customerRepository.js';
import { getAttemptsForPayment } from '../repositories/recoveryAttemptRepository.js';
import { POLICY_CONFIG } from '../config/policyConfig.js';
import type { PolicyInput, PolicyDecision, ScoreBreakdown } from '../types/policy.js';
import type { PaymentMethod, PaymentStatus, FailureReason } from '../types/domain.js';
import { paymentMethodToDomain, paymentStatusToDomain } from '../types/prismaMapping.js';

export interface BatchRecoveryOptions {
  merchantId?: string;
  limit?: number;
  dryRun?: boolean;
  paymentIds?: string[];
}

export interface BatchItemResult {
  paymentId: string;
  customerId: string;
  gatewayPaymentId: string;
  amountINR: number;
  amountMinor: string;
  currency: string;
  paymentMethod: string;
  failureReason: string;
  statusBefore: string;
  statusAfter: string;
  aiDiagnosis: string;
  aiConfidence: number;
  recoveryScore: number;
  policyDecision: string;
  policyAction: string;
  ruleTriggered: number;
  reasonCode: string;
  reason: string;
  recoveredAmountINR: number;
  dryRun: boolean;
}

export interface BatchRecoveryResult {
  batchId: string;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  totalProcessed: number;
  totalAtRiskINR: number;
  totalRecoveredINR: number;
  recoveryRatePercent: number;
  breakdown: {
    automatedRecoveries: number;
    humanApprovalsQueued: number;
    stoppedOrDenied: number;
    stoppingReasons: Record<string, number>;
  };
  items: BatchItemResult[];
}

export async function processBatchRecovery(
  options: BatchRecoveryOptions = {},
): Promise<BatchRecoveryResult> {
  const startedAt = new Date().toISOString();
  const batchId = `batch_${Date.now()}`;
  const isDryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 50;

  // 1. Fetch eligible failed payments
  const queryWhere: Record<string, unknown> = {
    status: 'FAILED',
  };

  if (options.merchantId) {
    queryWhere['merchantId'] = options.merchantId;
  }

  if (options.paymentIds && options.paymentIds.length > 0) {
    queryWhere['id'] = { in: options.paymentIds };
  }

  const rawPayments = await prisma.payment.findMany({
    where: queryWhere,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      merchant: { select: { automationEnabled: true } },
    },
  });

  let totalAtRiskINR = 0;
  let totalRecoveredINR = 0;
  let automatedRecoveries = 0;
  let humanApprovalsQueued = 0;
  let stoppedOrDenied = 0;
  const stoppingReasons: Record<string, number> = {};
  const items: BatchItemResult[] = [];

  // 2. Iterate through each payment in the batch
  for (const p of rawPayments) {
    const amountMinorNumber = Number(p.amountMinor);
    const amountINR = amountMinorNumber / 100;
    totalAtRiskINR += amountINR;

    const paymentMethod = paymentMethodToDomain(p.paymentMethod);
    const failureReason = (p.failureReason as FailureReason) ?? 'UNKNOWN';

    if (isDryRun) {
      // ── DRY-RUN MODE: Pure simulation without writing state ────────────────
      const customerState = await getCustomerState(p.customerId);
      const attempts = await getAttemptsForPayment(p.id);
      const lastAttempt = attempts[attempts.length - 1];

      const diag = await diagnosePaymentFailure({
        failureReason,
        paymentMethod,
        amountMinor: p.amountMinor,
        currency: p.currency,
        customerRiskFlag: customerState.riskFlag,
        retryCount: attempts.length,
      });

      const highValueFlag = amountMinorNumber >= POLICY_CONFIG.highValueThresholdMinor;

      const policyInput: PolicyInput = {
        transactionId: p.id,
        customerId: p.customerId,
        amount: amountMinorNumber,
        currency: p.currency,
        paymentMethod,
        failureReason,
        transactionCreatedAt: p.transactionCreatedAt.toISOString(),
        eventReceivedAt: new Date().toISOString(),
        previousSuccessfulPayments: customerState.previousSuccessfulPayments,
        previousFailedPayments: customerState.previousFailedPayments,
        customerStatus: customerState.status,
        customerRiskFlag: customerState.riskFlag,
        retryCount: attempts.length,
        lastRetryAt: lastAttempt ? lastAttempt.startedAt : null,
        alreadyRecovered: false,
        aiDiagnosis: diag.aiResponse.diagnosis,
        aiConfidence: diag.aiResponse.confidence,
        aiRecommendedAction: diag.aiResponse.recommendedAction,
        aiReasoningFactors: diag.aiResponse.reasoningFactors,
        aiResponseValid: diag.aiValid,
        recoveryScore: 0,
        riskLevel: customerState.riskFlag ? 'high' : highValueFlag ? 'medium' : 'low',
        highValueFlag,
        suspiciousDataFlag: false,
        automationEnabledForMerchant: p.merchant.automationEnabled,
        idempotencyKey: `dry_run_${p.id}`,
        eventAlreadyProcessed: false,
        inFlightLock: false,
      };

      const score = calculateRecoveryScore(policyInput);
      policyInput.recoveryScore = score.total;
      const decision = evaluatePolicy(policyInput, score);

      let statusAfter = 'failed';
      let recoveredAmountINR = 0;

      if (decision.decision === 'ALLOW') {
        automatedRecoveries++;
        statusAfter = 'recovered (simulated)';
        recoveredAmountINR = amountINR;
        totalRecoveredINR += amountINR;
      } else if (decision.decision === 'HUMAN_APPROVAL_REQUIRED') {
        humanApprovalsQueued++;
        statusAfter = 'human_review_queued';
        stoppingReasons[decision.reasonCode] = (stoppingReasons[decision.reasonCode] ?? 0) + 1;
      } else {
        stoppedOrDenied++;
        statusAfter = 'recovery_denied';
        stoppingReasons[decision.reasonCode] = (stoppingReasons[decision.reasonCode] ?? 0) + 1;
      }

      items.push({
        paymentId: p.id,
        customerId: p.customerId,
        gatewayPaymentId: p.gatewayPaymentId,
        amountINR,
        amountMinor: p.amountMinor.toString(),
        currency: p.currency,
        paymentMethod: p.paymentMethod,
        failureReason: p.failureReason ?? 'UNKNOWN',
        statusBefore: 'failed',
        statusAfter,
        aiDiagnosis: diag.aiResponse.diagnosis,
        aiConfidence: diag.aiResponse.confidence,
        recoveryScore: score.total,
        policyDecision: decision.decision,
        policyAction: decision.action,
        ruleTriggered: decision.ruleTriggered,
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        recoveredAmountINR,
        dryRun: true,
      });
    } else {
      // ── LIVE MODE: Executes full pipeline with DB writes & audit log ───────
      const gatewayEventId = `evt_batch_${Date.now()}_${p.id}`;

      const res = await processPaymentFailureEvent({
        merchantId: p.merchantId,
        gatewayEventId,
        paymentId: p.id,
        eventReceivedAt: new Date().toISOString(),
        rawPayload: {
          batchId,
          source: 'Batch_Recovery_Engine',
          event: 'payment.failed',
        },
      });

      let statusAfter = 'failed';
      let recoveredAmountINR = 0;

      if (res.status === 'RECOVERED') {
        automatedRecoveries++;
        statusAfter = 'recovered';
        recoveredAmountINR = amountINR;
        totalRecoveredINR += amountINR;
      } else if (res.status === 'HUMAN_REVIEW_REQUIRED') {
        humanApprovalsQueued++;
        statusAfter = 'human_review_queued';
        if (res.decision) {
          stoppingReasons[res.decision.reasonCode] =
            (stoppingReasons[res.decision.reasonCode] ?? 0) + 1;
        }
      } else {
        stoppedOrDenied++;
        statusAfter = 'recovery_denied';
        if (res.decision) {
          stoppingReasons[res.decision.reasonCode] =
            (stoppingReasons[res.decision.reasonCode] ?? 0) + 1;
        }
      }

      items.push({
        paymentId: p.id,
        customerId: p.customerId,
        gatewayPaymentId: p.gatewayPaymentId,
        amountINR,
        amountMinor: p.amountMinor.toString(),
        currency: p.currency,
        paymentMethod: p.paymentMethod,
        failureReason: p.failureReason ?? 'UNKNOWN',
        statusBefore: 'failed',
        statusAfter,
        aiDiagnosis: res.decision?.action ?? 'UNKNOWN',
        aiConfidence: res.score?.confidenceScore ? res.score.confidenceScore / 100 : 0.85,
        recoveryScore: res.score?.total ?? 0,
        policyDecision: res.decision?.decision ?? 'DENY',
        policyAction: res.decision?.action ?? 'NO_ACTION',
        ruleTriggered: res.decision?.ruleTriggered ?? 0,
        reasonCode: res.decision?.reasonCode ?? 'UNKNOWN',
        reason: res.decision?.reason ?? res.message,
        recoveredAmountINR,
        dryRun: false,
      });
    }
  }

  const recoveryRatePercent =
    totalAtRiskINR > 0 ? Math.round((totalRecoveredINR / totalAtRiskINR) * 100) : 0;

  return {
    batchId,
    startedAt,
    completedAt: new Date().toISOString(),
    dryRun: isDryRun,
    totalProcessed: rawPayments.length,
    totalAtRiskINR,
    totalRecoveredINR,
    recoveryRatePercent,
    breakdown: {
      automatedRecoveries,
      humanApprovalsQueued,
      stoppedOrDenied,
      stoppingReasons,
    },
    items,
  };
}
