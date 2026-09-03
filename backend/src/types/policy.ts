import type {
  PaymentMethod,
  CustomerStatus,
  FailureReason,
  PaymentStatus,
} from './domain.js';
import type { AIDiagnosis } from './ai.js';

export type RecoveryAction =
  | 'SMART_RETRY'
  | 'CUSTOMER_RECOVERY'
  | 'HUMAN_REVIEW'
  | 'NO_ACTION';

export type PolicyDecisionType = 'ALLOW' | 'DENY' | 'HUMAN_APPROVAL_REQUIRED';

export type ReasonCode =
  | 'AUTOMATION_DISABLED'
  | 'DUPLICATE_EVENT'
  | 'CONCURRENT_RECOVERY'
  | 'ALREADY_RECOVERED'
  | 'CUSTOMER_BLOCKED'
  | 'FRAUD_BLOCK'
  | 'RETRY_LIMIT_REACHED'
  | 'COOLDOWN_ACTIVE'
  | 'STALE_EVENT'
  | 'SUSPICIOUS_DATA'
  | 'HIGH_VALUE_REVIEW'
  | 'AI_INVALID'
  | 'AI_LOW_CONFIDENCE'
  | 'UNKNOWN_FAILURE'
  | 'HIGH_RECOVERY_SCORE'
  | 'MEDIUM_RECOVERY_SCORE'
  | 'LOW_RECOVERY_SCORE';

// ---------------------------------------------------------------------------
// ScoreBreakdown — supports component scores, weighted components, and a
// final rounded total. The calculation is NOT implemented here.
//
// Future formula (exactly one final Math.round() call, implemented later):
//   Score = round(
//     0.35*FailureReason + 0.20*Retry + 0.15*Recency +
//     0.20*History + 0.10*Confidence
//   )
// ---------------------------------------------------------------------------
export interface ScoreBreakdown {
  total: number;
  failureReasonScore: number;
  retryScore: number;
  recencyScore: number;
  historyScore: number;
  confidenceScore: number;
}

export interface PolicyInput {
  transactionId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  failureReason: FailureReason;
  failureCode?: string;
  transactionCreatedAt: string;
  eventReceivedAt: string;
  previousSuccessfulPayments: number;
  previousFailedPayments: number;
  customerStatus: CustomerStatus;
  customerRiskFlag: boolean;
  retryCount: number;
  lastRetryAt: string | null;
  alreadyRecovered: boolean;
  aiDiagnosis: AIDiagnosis;
  aiConfidence: number;
  aiRecommendedAction: RecoveryAction;
  aiReasoningFactors: string[];
  aiResponseValid: boolean;
  recoveryScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  highValueFlag: boolean;
  suspiciousDataFlag: boolean;
  automationEnabledForMerchant: boolean;
  idempotencyKey: string;
  eventAlreadyProcessed: boolean;
  inFlightLock: boolean;
}

export interface PolicyDecision {
  decision: PolicyDecisionType;
  action: RecoveryAction;
  reasonCode: ReasonCode;
  reason: string;
  ruleTriggered: number;
  retryEligibleAt?: string;
  aiRecommendationUsed: boolean;
}

// ---------------------------------------------------------------------------
// ExecutionContext — server-controlled only, built exclusively from a fresh
// DB read keyed by transactionId. No function signature anywhere in the
// codebase may accept AIResponse as a parameter alongside execution logic.
// The AI must never be able to reach the action executor directly — this is
// structurally impossible, not just avoided by convention.
//
// paymentStatusAtExecution exists to guard against executing on a payment
// whose state changed between decision time and execution time (e.g. the
// customer paid manually in the interim). A future action executor MUST
// check this value (e.g. abort if status is already 'succeeded' or
// 'refunded') before performing any side effect. That check is NOT
// implemented in this prompt — narrowing/branching on
// paymentStatusAtExecution is explicitly future work.
// ---------------------------------------------------------------------------
export interface ExecutionContext {
  transactionId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  gatewayPaymentId: string;
  paymentStatusAtExecution: PaymentStatus;
}

// ---------------------------------------------------------------------------
// Timestamp contract:
//   - transactionCreatedAt: when the original payment was created.
//   - eventReceivedAt: when the failure event arrived at this service.
//   - evaluationTime: when the policy engine evaluates this event (future).
//
// Derived (comments only, no implementation):
//   transactionAgeMinutes        = evaluationTime − transactionCreatedAt
//   eventDeliveryDelayMinutes    = eventReceivedAt − transactionCreatedAt
//
// The future stale-event rule uses eventDeliveryDelayMinutes,
// NOT transactionAgeMinutes.
//
// eventReceivedAt < transactionCreatedAt is an invalid ordering that will be
// rejected during future ingestion as "INVALID_TIMESTAMP_ORDER". This is an
// ingestion-layer rejection, NOT a policy ReasonCode, and must never be
// added to the ReasonCode union.
// ---------------------------------------------------------------------------
