// Recovery decision repository — DB access layer stub for persisting
// PolicyDecision and ScoreBreakdown. All functions throw "not implemented".

import type { PolicyDecision, ScoreBreakdown } from '../types/policy.js';
import type { AIResponse } from '../types/ai.js';

export interface RecoveryDecisionRecord {
  id: string;
  paymentId: string;
  recoveryAttemptId: string | null;
  eventId: string;
  evaluationTime: string;
  failureReasonScore: number | null;
  retryScore: number | null;
  recencyScore: number | null;
  historyScore: number | null;
  confidenceScore: number | null;
  recoveryScore: number | null;
  policyRuleTriggered: string;
  policyDecision: string;
  action: string;
  aiResponse: AIResponse | null;
  aiValid: boolean;
  createdAt: string;
}

export interface RecoveryDecisionInsert {
  paymentId: string;
  recoveryAttemptId: string | null;
  eventId: string;
  evaluationTime: string;
  scoreBreakdown: ScoreBreakdown | null;
  policyDecision: PolicyDecision;
  aiResponse: AIResponse | null;
  aiValid: boolean;
}

export function insertRecoveryDecision(
  _insert: RecoveryDecisionInsert,
): Promise<RecoveryDecisionRecord> {
  throw new Error('not implemented');
}

export function getDecisionsForPayment(
  _paymentId: string,
): Promise<RecoveryDecisionRecord[]> {
  throw new Error('not implemented');
}
