// Centralized policy configuration — Frozen V1 constants.
// These values must never be hardcoded anywhere else in the codebase.

export const POLICY_CONFIG = Object.freeze({
  maxRetryLimit: 3,
  cooldownPeriodMinutes: 30,
  highValueThresholdMinor: 5_000_000,
  staleEventThresholdMinutes: 180,
  allowThreshold: 70,
  humanReviewThreshold: 40,
  lowConfidenceThreshold: 0.5,
  scoreWeights: Object.freeze({
    failureReason: 0.35,
    retry: 0.20,
    recency: 0.15,
    history: 0.20,
    confidence: 0.10,
  }),
});

export type PolicyConfig = typeof POLICY_CONFIG;
