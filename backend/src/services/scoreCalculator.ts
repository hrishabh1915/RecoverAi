// Score Calculator — deterministic weighted scoring formula.
//
// Formula:
//   Score = round(
//     0.35*FailureReason + 0.20*Retry + 0.15*Recency +
//     0.20*History + 0.10*Confidence
//   )
//
// Exactly one final Math.round() call.

import { POLICY_CONFIG } from '../config/policyConfig.js';
import type { ScoreBreakdown, PolicyInput } from '../types/policy.js';
import type { FailureReason } from '../types/domain.js';

export function calculateFailureReasonScore(reason: FailureReason): number {
  switch (reason) {
    case 'NETWORK_ERROR':
      return 95;
    case 'INSUFFICIENT_FUNDS':
      return 75;
    case 'BANK_DECLINED_GENERIC':
      return 60;
    case 'AUTH_FAILURE':
      return 45;
    case 'UNKNOWN':
      return 30;
    case 'EXPIRED_CARD':
      return 20;
    case 'FRAUD_SUSPECTED':
      return 0;
  }
}

export function calculateRetryScore(retryCount: number): number {
  if (retryCount <= 0) return 100;
  if (retryCount === 1) return 70;
  if (retryCount === 2) return 35;
  return 0;
}

export function calculateRecencyScore(delayMinutes: number): number {
  if (delayMinutes <= 5) return 100;
  if (delayMinutes <= 30) return 85;
  if (delayMinutes <= 60) return 65;
  if (delayMinutes <= POLICY_CONFIG.staleEventThresholdMinutes) return 35;
  return 0;
}

export function calculateHistoryScore(
  previousSuccessful: number,
  previousFailed: number,
  isRisk: boolean,
): number {
  if (isRisk) return 0;
  const total = previousSuccessful + previousFailed;
  if (total === 0) return 60; // Baseline for first-time customer
  const rate = previousSuccessful / total;
  return Math.min(100, Math.max(0, Math.round(rate * 100)));
}

export function calculateConfidenceScore(confidence: number, isValid: boolean): number {
  if (!isValid) return 0;
  const clamped = Math.min(1, Math.max(0, confidence));
  return Math.round(clamped * 100);
}

export function calculateRecoveryScore(input: PolicyInput): ScoreBreakdown {
  const failureReasonScore = calculateFailureReasonScore(input.failureReason);
  const retryScore = calculateRetryScore(input.retryCount);

  // Recency: difference between eventReceivedAt and transactionCreatedAt in minutes
  const txCreated = new Date(input.transactionCreatedAt).getTime();
  const eventReceived = new Date(input.eventReceivedAt).getTime();
  const delayMinutes = Math.max(0, (eventReceived - txCreated) / (1000 * 60));
  const recencyScore = calculateRecencyScore(delayMinutes);

  const isRisk = input.customerRiskFlag || input.customerStatus === 'blocked';
  const historyScore = calculateHistoryScore(
    input.previousSuccessfulPayments,
    input.previousFailedPayments,
    isRisk,
  );

  const confidenceScore = calculateConfidenceScore(input.aiConfidence, input.aiResponseValid);

  const weights = POLICY_CONFIG.scoreWeights;
  const weightedSum =
    failureReasonScore * weights.failureReason +
    retryScore * weights.retry +
    recencyScore * weights.recency +
    historyScore * weights.history +
    confidenceScore * weights.confidence;

  const total = Math.round(weightedSum);

  return {
    total,
    failureReasonScore,
    retryScore,
    recencyScore,
    historyScore,
    confidenceScore,
  };
}
