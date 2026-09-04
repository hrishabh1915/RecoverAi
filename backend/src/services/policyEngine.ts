// Deterministic Policy Engine.
// Evaluates PolicyInput against strict, deterministic safety rules in priority order.
// AI only recommends. Deterministic policy disposes.

import { POLICY_CONFIG } from '../config/policyConfig.js';
import type { PolicyInput, PolicyDecision, ScoreBreakdown } from '../types/policy.js';

export function evaluatePolicy(
  input: PolicyInput,
  score: ScoreBreakdown,
  evaluationTime: Date = new Date(),
): PolicyDecision {
  // Rule 1: Automation disabled for merchant
  if (!input.automationEnabledForMerchant) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'AUTOMATION_DISABLED',
      reason: 'Merchant has automated recovery disabled.',
      ruleTriggered: 1,
      aiRecommendationUsed: false,
    };
  }

  // Rule 2: Duplicate event already processed
  if (input.eventAlreadyProcessed) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'DUPLICATE_EVENT',
      reason: 'Duplicate webhook event received; idempotency guard prevented duplicate processing.',
      ruleTriggered: 2,
      aiRecommendationUsed: false,
    };
  }

  // Rule 3: Concurrent in-flight recovery attempt active
  if (input.inFlightLock) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'CONCURRENT_RECOVERY',
      reason: 'A recovery attempt is currently in-flight for this payment.',
      ruleTriggered: 3,
      aiRecommendationUsed: false,
    };
  }

  // Rule 4: Payment already succeeded or recovered
  if (input.alreadyRecovered) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'ALREADY_RECOVERED',
      reason: 'Payment has already been successfully recovered or paid.',
      ruleTriggered: 4,
      aiRecommendationUsed: false,
    };
  }

  // Rule 5: Customer is explicitly blocked
  if (input.customerStatus === 'blocked') {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'CUSTOMER_BLOCKED',
      reason: 'Customer account is blocked by merchant or security rules.',
      ruleTriggered: 5,
      aiRecommendationUsed: false,
    };
  }

  // Rule 6: Fraud suspected or flagged
  if (input.failureReason === 'FRAUD_SUSPECTED' || input.customerRiskFlag) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'FRAUD_BLOCK',
      reason: 'Fraud risk detected; automated recovery denied for compliance & safety.',
      ruleTriggered: 6,
      aiRecommendationUsed: false,
    };
  }

  // Rule 7: Max retry limit reached (Frozen V1: 3)
  if (input.retryCount >= POLICY_CONFIG.maxRetryLimit) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'RETRY_LIMIT_REACHED',
      reason: `Maximum retry limit (${POLICY_CONFIG.maxRetryLimit}) reached. Stopping automated retries.`,
      ruleTriggered: 7,
      aiRecommendationUsed: false,
    };
  }

  // Rule 8: Cooldown period active (30 minutes between attempts)
  if (input.lastRetryAt) {
    const lastRetryTime = new Date(input.lastRetryAt).getTime();
    const evalMs = evaluationTime.getTime();
    const elapsedMinutes = (evalMs - lastRetryTime) / (1000 * 60);

    if (elapsedMinutes < POLICY_CONFIG.cooldownPeriodMinutes) {
      const eligibleTime = new Date(
        lastRetryTime + POLICY_CONFIG.cooldownPeriodMinutes * 60 * 1000,
      );
      return {
        decision: 'DENY',
        action: 'NO_ACTION',
        reasonCode: 'COOLDOWN_ACTIVE',
        reason: `Cooldown active. Next retry eligible at ${eligibleTime.toISOString()}.`,
        ruleTriggered: 8,
        retryEligibleAt: eligibleTime.toISOString(),
        aiRecommendationUsed: false,
      };
    }
  }

  // Rule 9: Stale event delivery delay (> 180 min from transaction creation to event arrival)
  const txCreatedMs = new Date(input.transactionCreatedAt).getTime();
  const eventReceivedMs = new Date(input.eventReceivedAt).getTime();
  const eventDeliveryDelayMinutes = Math.max(0, (eventReceivedMs - txCreatedMs) / (1000 * 60));

  if (eventDeliveryDelayMinutes > POLICY_CONFIG.staleEventThresholdMinutes) {
    return {
      decision: 'DENY',
      action: 'NO_ACTION',
      reasonCode: 'STALE_EVENT',
      reason: `Event delivery delay (${Math.round(eventDeliveryDelayMinutes)} min) exceeds threshold (${POLICY_CONFIG.staleEventThresholdMinutes} min).`,
      ruleTriggered: 9,
      aiRecommendationUsed: false,
    };
  }

  // Rule 10: Suspicious data flags detected
  if (input.suspiciousDataFlag) {
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      action: 'HUMAN_REVIEW',
      reasonCode: 'SUSPICIOUS_DATA',
      reason: 'Suspicious payload or data integrity anomaly requires manual review.',
      ruleTriggered: 10,
      aiRecommendationUsed: false,
    };
  }

  // Rule 11: High value transaction (>= ₹50,000 / 5,000,000 paise)
  if (input.highValueFlag || input.amount >= POLICY_CONFIG.highValueThresholdMinor) {
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      action: 'HUMAN_REVIEW',
      reasonCode: 'HIGH_VALUE_REVIEW',
      reason: `High value transaction (${input.amount / 100} ${input.currency}) requires human approval before recovery.`,
      ruleTriggered: 11,
      aiRecommendationUsed: false,
    };
  }

  // Rule 12: AI response invalid or malformed schema
  if (!input.aiResponseValid) {
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      action: 'HUMAN_REVIEW',
      reasonCode: 'AI_INVALID',
      reason: 'AI diagnosis output was invalid or failed strict schema validation; fallback to human review.',
      ruleTriggered: 12,
      aiRecommendationUsed: false,
    };
  }

  // Rule 13: Low confidence from AI diagnosis (< 0.5)
  if (input.aiConfidence < POLICY_CONFIG.lowConfidenceThreshold) {
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      action: 'HUMAN_REVIEW',
      reasonCode: 'AI_LOW_CONFIDENCE',
      reason: `AI confidence (${input.aiConfidence}) is below safety threshold (${POLICY_CONFIG.lowConfidenceThreshold}).`,
      ruleTriggered: 13,
      aiRecommendationUsed: false,
    };
  }

  // Rule 14: Unknown failure reason
  if (input.failureReason === 'UNKNOWN' || input.aiDiagnosis === 'UNKNOWN') {
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      action: 'HUMAN_REVIEW',
      reasonCode: 'UNKNOWN_FAILURE',
      reason: 'Payment failure code cannot be deterministically classified.',
      ruleTriggered: 14,
      aiRecommendationUsed: false,
    };
  }

  // Rule 15: High Recovery Score (>= 70) -> ALLOW automated recovery
  if (score.total >= POLICY_CONFIG.allowThreshold) {
    const action = input.aiRecommendedAction || 'SMART_RETRY';
    return {
      decision: 'ALLOW',
      action,
      reasonCode: 'HIGH_RECOVERY_SCORE',
      reason: `Recovery score of ${score.total}/100 exceeds allow threshold (${POLICY_CONFIG.allowThreshold}). Automated action permitted.`,
      ruleTriggered: 15,
      aiRecommendationUsed: true,
    };
  }

  // Rule 16: Medium Recovery Score (40 - 69) -> Conditional action
  if (score.total >= POLICY_CONFIG.humanReviewThreshold) {
    return {
      decision: 'ALLOW',
      action: 'CUSTOMER_RECOVERY',
      reasonCode: 'MEDIUM_RECOVERY_SCORE',
      reason: `Recovery score of ${score.total}/100 meets medium threshold (${POLICY_CONFIG.humanReviewThreshold}). Self-serve customer recovery recommended.`,
      ruleTriggered: 16,
      aiRecommendationUsed: true,
    };
  }

  // Rule 17: Low Recovery Score (< 40) -> DENY
  return {
    decision: 'DENY',
    action: 'NO_ACTION',
    reasonCode: 'LOW_RECOVERY_SCORE',
    reason: `Recovery score of ${score.total}/100 is below minimum threshold (${POLICY_CONFIG.humanReviewThreshold}). Recovery not recommended.`,
    ruleTriggered: 17,
    aiRecommendationUsed: false,
  };
}
