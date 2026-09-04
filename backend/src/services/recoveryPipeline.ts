// Recovery Pipeline Service.
// Orchestrates: Inbound Event → Idempotency → DB State → AI Diagnosis →
// Scoring → Deterministic Policy → Execution Guard → Execution → Audit Log.

import {
  isEventProcessed,
  insertProcessedEvent,
  getPaymentById,
  updatePayment,
  getCustomerState,
  getCustomerById,
  getActiveAttemptForPayment,
  getAttemptsForPayment,
  createRecoveryAttempt,
  updateAttemptStatus,
  insertRecoveryDecision,
  insertAuditLog,
  buildExecutionContext,
  type PaymentRecord,
} from '../repositories/index.js';
import { calculateRecoveryScore } from './scoreCalculator.js';
import { evaluatePolicy } from './policyEngine.js';
import { validateAIResponse, type AIResponse } from '../types/ai.js';
import { diagnosePaymentFailure } from './aiDiagnosisService.js';
import type { PolicyInput, PolicyDecision, ScoreBreakdown } from '../types/policy.js';
import type { FailureReason } from '../types/domain.js';
import { POLICY_CONFIG } from '../config/policyConfig.js';
import { prisma } from '../lib/prisma.js';

export interface InboundPaymentFailedEvent {
  merchantId: string;
  gatewayEventId: string;
  paymentId: string;
  eventReceivedAt?: string;
  rawPayload?: Record<string, unknown>;
  // Optional pre-computed AI mock for testing/simulation
  aiOverride?: unknown;
}

export interface PipelineResult {
  success: boolean;
  status: 'PROCESSED' | 'DUPLICATE' | 'HUMAN_REVIEW_REQUIRED' | 'RECOVERY_DENIED' | 'RECOVERED' | 'RETRY_FAILED';
  paymentId: string;
  gatewayEventId: string;
  score?: ScoreBreakdown;
  decision?: PolicyDecision;
  recoveredAmount?: number;
  message: string;
}

export async function processPaymentFailureEvent(
  event: InboundPaymentFailedEvent,
): Promise<PipelineResult> {
  const eventReceivedAt = event.eventReceivedAt ?? new Date().toISOString();

  // 1. Idempotency Check
  const alreadyProcessed = await isEventProcessed(event.merchantId, event.gatewayEventId);
  if (alreadyProcessed) {
    await insertAuditLog({
      entityType: 'payment',
      entityId: event.paymentId,
      action: 'IDEMPOTENCY_DUPLICATE_IGNORED',
      actor: 'system',
      details: {
        gatewayEventId: event.gatewayEventId,
        merchantId: event.merchantId,
        reason: 'Duplicate webhook event received; ignored to prevent double action',
      },
    });

    return {
      success: true,
      status: 'DUPLICATE',
      paymentId: event.paymentId,
      gatewayEventId: event.gatewayEventId,
      message: 'Duplicate event received and safely ignored.',
    };
  }

  // 2. Fetch fresh DB state
  const payment = await getPaymentById(event.paymentId);
  if (!payment) {
    throw new Error(`Payment not found: ${event.paymentId}`);
  }

  const customer = await getCustomerById(payment.customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${payment.customerId}`);
  }

  const customerState = await getCustomerState(payment.customerId);
  const merchant = await prisma.merchant.findUnique({
    where: { id: event.merchantId },
  });

  const previousAttempts = await getAttemptsForPayment(payment.id);
  const activeAttempt = await getActiveAttemptForPayment(payment.id);

  const retryCount = previousAttempts.length;
  const lastAttempt = previousAttempts[previousAttempts.length - 1];
  const lastRetryAt = lastAttempt ? lastAttempt.startedAt : null;

  // 3. Record the processed event in DB
  const processedEventRecord = await insertProcessedEvent(
    event.merchantId,
    event.gatewayEventId,
    payment.id,
    eventReceivedAt,
    event.rawPayload ?? {},
  );

  // 4. AI Diagnosis (with strict Zod schema validation and safe fallback)
  let aiResponse: AIResponse;
  let aiValid = true;

  if (event.aiOverride) {
    const validated = validateAIResponse(event.aiOverride);
    if (validated.success) {
      aiResponse = validated.data;
    } else {
      aiValid = false;
      aiResponse = {
        diagnosis: 'UNKNOWN',
        confidence: 0,
        recommendedAction: 'HUMAN_REVIEW',
        reasoningFactors: ['Schema validation rejected manual AI override'],
      };
    }
  } else {
    const rawPayloadObj = (typeof event.rawPayload === 'object' && event.rawPayload !== null)
      ? (event.rawPayload as Record<string, unknown>)
      : {};
    const errDesc = typeof rawPayloadObj['error_description'] === 'string'
      ? rawPayloadObj['error_description']
      : undefined;
    const errCode = typeof rawPayloadObj['error_code'] === 'string'
      ? rawPayloadObj['error_code']
      : undefined;

    const diagnosis = await diagnosePaymentFailure({
      failureReason: payment.failureReason ?? 'UNKNOWN',
      failureCode: errCode,
      errorMessage: errDesc,
      paymentMethod: payment.paymentMethod,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      customerRiskFlag: customerState.riskFlag,
      retryCount,
      rawPayload: event.rawPayload,
    });

    aiResponse = diagnosis.aiResponse;
    aiValid = diagnosis.aiValid;
  }

  // 5. Construct PolicyInput
  const amountMinorNumber = Number(payment.amountMinor);
  const highValueFlag = amountMinorNumber >= POLICY_CONFIG.highValueThresholdMinor;

  const policyInput: PolicyInput = {
    transactionId: payment.id,
    customerId: payment.customerId,
    amount: amountMinorNumber,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod,
    failureReason: payment.failureReason ?? 'UNKNOWN',
    transactionCreatedAt: payment.transactionCreatedAt,
    eventReceivedAt,
    previousSuccessfulPayments: customerState.previousSuccessfulPayments,
    previousFailedPayments: customerState.previousFailedPayments,
    customerStatus: customerState.status,
    customerRiskFlag: customerState.riskFlag,
    retryCount,
    lastRetryAt,
    alreadyRecovered: payment.status === 'recovered' || payment.status === 'succeeded',
    aiDiagnosis: aiResponse.diagnosis,
    aiConfidence: aiResponse.confidence,
    aiRecommendedAction: aiResponse.recommendedAction,
    aiReasoningFactors: aiResponse.reasoningFactors,
    aiResponseValid: aiValid,
    recoveryScore: 0, // will be updated below
    riskLevel: customerState.riskFlag ? 'high' : highValueFlag ? 'medium' : 'low',
    highValueFlag,
    suspiciousDataFlag: false,
    automationEnabledForMerchant: merchant?.automationEnabled ?? true,
    idempotencyKey: event.gatewayEventId,
    eventAlreadyProcessed: false,
    inFlightLock: activeAttempt !== null,
  };

  // 6. Calculate Recovery Score
  const score = calculateRecoveryScore(policyInput);
  policyInput.recoveryScore = score.total;

  // 7. Evaluate Policy Engine
  const evaluationTime = new Date();
  const decision = evaluatePolicy(policyInput, score, evaluationTime);

  // 8. Persist Recovery Decision
  await insertRecoveryDecision({
    paymentId: payment.id,
    recoveryAttemptId: activeAttempt?.id ?? null,
    eventId: processedEventRecord.id,
    evaluationTime,
    scoreBreakdown: score,
    policyDecision: decision,
    aiResponse,
    aiValid,
  });

  // 9. Execution Guard & Execution (Strict server-side safety checks)
  let finalStatus: PipelineResult['status'] = 'PROCESSED';
  let recoveredAmount = 0;

  if (decision.decision === 'ALLOW') {
    // Fresh DB read for execution guard
    const execCtx = await buildExecutionContext(payment.id);

    // Guard: ensure payment has not already been resolved in the meantime
    if (execCtx.paymentStatusAtExecution === 'succeeded' || execCtx.paymentStatusAtExecution === 'recovered') {
      await insertAuditLog({
        entityType: 'payment',
        entityId: payment.id,
        action: 'EXECUTION_ABORTED_ALREADY_RESOLVED',
        actor: 'execution_guard',
        details: { status: execCtx.paymentStatusAtExecution },
      });
      return {
        success: true,
        status: 'PROCESSED',
        paymentId: payment.id,
        gatewayEventId: event.gatewayEventId,
        score,
        decision,
        message: 'Payment already resolved prior to execution; action aborted safely.',
      };
    }

    // Create in-flight attempt record
    const attempt = await createRecoveryAttempt(payment.id, retryCount + 1, evaluationTime);

    // Execute Recovery Action (Simulated gateway transaction based on recovery probability)
    // High recovery score items have high success probability
    const recoverySuccess = score.total >= 60 || Math.random() < 0.75;

    if (recoverySuccess) {
      await updateAttemptStatus(attempt.id, 'completed', new Date());
      await updatePayment(payment.id, {
        status: 'recovered',
        recoveredAt: new Date().toISOString(),
      });
      finalStatus = 'RECOVERED';
      recoveredAmount = amountMinorNumber;

      await insertAuditLog({
        entityType: 'payment',
        entityId: payment.id,
        action: 'PAYMENT_RECOVERED',
        actor: 'recovery_engine',
        details: {
          action: decision.action,
          amountMinor: amountMinorNumber,
          currency: payment.currency,
          score: score.total,
          rule: decision.ruleTriggered,
        },
      });
    } else {
      await updateAttemptStatus(attempt.id, 'failed', new Date());
      finalStatus = 'RETRY_FAILED';

      await insertAuditLog({
        entityType: 'payment',
        entityId: payment.id,
        action: 'RECOVERY_ATTEMPT_FAILED',
        actor: 'recovery_engine',
        details: {
          action: decision.action,
          retryCount: retryCount + 1,
        },
      });
    }
  } else if (decision.decision === 'HUMAN_APPROVAL_REQUIRED') {
    finalStatus = 'HUMAN_REVIEW_REQUIRED';
    await insertAuditLog({
      entityType: 'payment',
      entityId: payment.id,
      action: 'HUMAN_APPROVAL_QUEUED',
      actor: 'policy_engine',
      details: {
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        amountMinor: amountMinorNumber,
      },
    });
  } else {
    // DENY
    finalStatus = 'RECOVERY_DENIED';
    await insertAuditLog({
      entityType: 'payment',
      entityId: payment.id,
      action: 'RECOVERY_STOPPED',
      actor: 'policy_engine',
      details: {
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        retryCount,
      },
    });
  }

  return {
    success: true,
    status: finalStatus,
    paymentId: payment.id,
    gatewayEventId: event.gatewayEventId,
    score,
    decision,
    recoveredAmount,
    message: decision.reason,
  };
}
