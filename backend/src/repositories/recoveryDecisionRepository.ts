// Recovery decision repository — DB access layer for persisting
// PolicyDecision, ScoreBreakdown, and AIResponse records.

import { prisma } from '../lib/prisma.js';
import type { PolicyDecision, ScoreBreakdown } from '../types/policy.js';
import type { AIResponse } from '../types/ai.js';
import { validateAIResponse } from '../types/ai.js';

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
  evaluationTime: string | Date;
  scoreBreakdown: ScoreBreakdown | null;
  policyDecision: PolicyDecision;
  aiResponse: AIResponse | null;
  aiValid: boolean;
}

function toRecoveryDecisionRecord(row: {
  id: string;
  paymentId: string;
  recoveryAttemptId: string | null;
  eventId: string;
  evaluationTime: Date;
  failureReasonScore: number | null;
  retryScore: number | null;
  recencyScore: number | null;
  historyScore: number | null;
  confidenceScore: number | null;
  recoveryScore: number | null;
  policyRuleTriggered: string;
  policyDecision: string;
  action: string;
  aiResponse: string | null;
  aiValid: boolean;
  createdAt: Date;
}): RecoveryDecisionRecord {
  let aiResponse: AIResponse | null = null;
  if (row.aiResponse) {
    try {
      const parsed = JSON.parse(row.aiResponse);
      const val = validateAIResponse(parsed);
      if (val.success) {
        aiResponse = val.data;
      }
    } catch {
      aiResponse = null;
    }
  }

  return {
    id: row.id,
    paymentId: row.paymentId,
    recoveryAttemptId: row.recoveryAttemptId,
    eventId: row.eventId,
    evaluationTime: row.evaluationTime.toISOString(),
    failureReasonScore: row.failureReasonScore,
    retryScore: row.retryScore,
    recencyScore: row.recencyScore,
    historyScore: row.historyScore,
    confidenceScore: row.confidenceScore,
    recoveryScore: row.recoveryScore,
    policyRuleTriggered: row.policyRuleTriggered,
    policyDecision: row.policyDecision,
    action: row.action,
    aiResponse,
    aiValid: row.aiValid,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertRecoveryDecision(
  insert: RecoveryDecisionInsert,
): Promise<RecoveryDecisionRecord> {
  const aiResponseString = insert.aiResponse ? JSON.stringify(insert.aiResponse) : null;

  const row = await prisma.recoveryDecision.create({
    data: {
      paymentId: insert.paymentId,
      recoveryAttemptId: insert.recoveryAttemptId,
      eventId: insert.eventId,
      evaluationTime:
        typeof insert.evaluationTime === 'string'
          ? new Date(insert.evaluationTime)
          : insert.evaluationTime,
      failureReasonScore: insert.scoreBreakdown?.failureReasonScore ?? null,
      retryScore: insert.scoreBreakdown?.retryScore ?? null,
      recencyScore: insert.scoreBreakdown?.recencyScore ?? null,
      historyScore: insert.scoreBreakdown?.historyScore ?? null,
      confidenceScore: insert.scoreBreakdown?.confidenceScore ?? null,
      recoveryScore: insert.scoreBreakdown?.total ?? null,
      policyRuleTriggered: `Rule ${insert.policyDecision.ruleTriggered}: ${insert.policyDecision.reasonCode}`,
      policyDecision: insert.policyDecision.decision,
      action: insert.policyDecision.action,
      aiResponse: aiResponseString,
      aiValid: insert.aiValid,
    },
  });

  return toRecoveryDecisionRecord(row);
}

export async function getDecisionsForPayment(
  paymentId: string,
): Promise<RecoveryDecisionRecord[]> {
  const rows = await prisma.recoveryDecision.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toRecoveryDecisionRecord);
}
