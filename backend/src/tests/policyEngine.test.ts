import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../services/policyEngine.js';
import type { PolicyInput, ScoreBreakdown } from '../types/policy.js';

function createMockInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    transactionId: 'tx_test_1',
    customerId: 'cust_test_1',
    amount: 100000,
    currency: 'INR',
    paymentMethod: 'upi',
    failureReason: 'NETWORK_ERROR',
    transactionCreatedAt: '2026-09-01T10:00:00Z',
    eventReceivedAt: '2026-09-01T10:01:00Z',
    previousSuccessfulPayments: 3,
    previousFailedPayments: 0,
    customerStatus: 'active',
    customerRiskFlag: false,
    retryCount: 0,
    lastRetryAt: null,
    alreadyRecovered: false,
    aiDiagnosis: 'NETWORK_ERROR',
    aiConfidence: 0.90,
    aiRecommendedAction: 'SMART_RETRY',
    aiReasoningFactors: ['network_blip'],
    aiResponseValid: true,
    recoveryScore: 85,
    riskLevel: 'low',
    highValueFlag: false,
    suspiciousDataFlag: false,
    automationEnabledForMerchant: true,
    idempotencyKey: 'evt_test_1',
    eventAlreadyProcessed: false,
    inFlightLock: false,
    ...overrides,
  };
}

function createMockScore(total = 85): ScoreBreakdown {
  return {
    total,
    failureReasonScore: 90,
    retryScore: 100,
    recencyScore: 100,
    historyScore: 100,
    confidenceScore: 90,
  };
}

describe('Policy Engine', () => {
  it('Rule 1: Denies if automation is disabled for merchant', () => {
    const input = createMockInput({ automationEnabledForMerchant: false });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('AUTOMATION_DISABLED');
    expect(decision.ruleTriggered).toBe(1);
  });

  it('Rule 2: Denies duplicate events', () => {
    const input = createMockInput({ eventAlreadyProcessed: true });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('DUPLICATE_EVENT');
    expect(decision.ruleTriggered).toBe(2);
  });

  it('Rule 3: Denies concurrent in-flight recovery attempts', () => {
    const input = createMockInput({ inFlightLock: true });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('CONCURRENT_RECOVERY');
    expect(decision.ruleTriggered).toBe(3);
  });

  it('Rule 4: Denies if payment is already recovered', () => {
    const input = createMockInput({ alreadyRecovered: true });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('ALREADY_RECOVERED');
    expect(decision.ruleTriggered).toBe(4);
  });

  it('Rule 5: Denies if customer is blocked', () => {
    const input = createMockInput({ customerStatus: 'blocked' });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('CUSTOMER_BLOCKED');
    expect(decision.ruleTriggered).toBe(5);
  });

  it('Rule 6: Denies fraud suspected failure reasons', () => {
    const input = createMockInput({ failureReason: 'FRAUD_SUSPECTED' });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('FRAUD_BLOCK');
    expect(decision.ruleTriggered).toBe(6);
  });

  it('Rule 7: Denies when max retry limit (3) is reached', () => {
    const input = createMockInput({ retryCount: 3 });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('RETRY_LIMIT_REACHED');
    expect(decision.ruleTriggered).toBe(7);
  });

  it('Rule 8: Enforces 30-minute cooldown period between attempts', () => {
    const evalTime = new Date('2026-09-01T10:20:00Z');
    const input = createMockInput({
      retryCount: 1,
      lastRetryAt: '2026-09-01T10:05:00Z', // 15 min ago (within 30m cooldown)
    });
    const decision = evaluatePolicy(input, createMockScore(90), evalTime);
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('COOLDOWN_ACTIVE');
    expect(decision.ruleTriggered).toBe(8);
    expect(decision.retryEligibleAt).toBeDefined();
  });

  it('Rule 9: Denies stale events (> 180 min delivery delay)', () => {
    const input = createMockInput({
      transactionCreatedAt: '2026-09-01T06:00:00Z',
      eventReceivedAt: '2026-09-01T10:00:00Z', // 240 min delay
    });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('STALE_EVENT');
    expect(decision.ruleTriggered).toBe(9);
  });

  it('Rule 11: Escalates high-value transactions (>= ₹50,000) to Human Approval', () => {
    const input = createMockInput({ amount: 6_000_000 }); // ₹60,000 (6,000,000 paise)
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(decision.action).toBe('HUMAN_REVIEW');
    expect(decision.reasonCode).toBe('HIGH_VALUE_REVIEW');
    expect(decision.ruleTriggered).toBe(11);
  });

  it('Rule 12: Escalates to Human Approval if AI response is invalid', () => {
    const input = createMockInput({ aiResponseValid: false });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(decision.reasonCode).toBe('AI_INVALID');
    expect(decision.ruleTriggered).toBe(12);
  });

  it('Rule 13: Escalates to Human Approval if AI confidence is low (< 0.5)', () => {
    const input = createMockInput({ aiConfidence: 0.35 });
    const decision = evaluatePolicy(input, createMockScore(90));
    expect(decision.decision).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(decision.reasonCode).toBe('AI_LOW_CONFIDENCE');
    expect(decision.ruleTriggered).toBe(13);
  });

  it('Rule 15: Allows automated recovery for high recovery score (>= 70)', () => {
    const input = createMockInput();
    const decision = evaluatePolicy(input, createMockScore(85));
    expect(decision.decision).toBe('ALLOW');
    expect(decision.action).toBe('SMART_RETRY');
    expect(decision.reasonCode).toBe('HIGH_RECOVERY_SCORE');
    expect(decision.ruleTriggered).toBe(15);
  });

  it('Rule 16: Allows customer recovery for medium recovery score (40 - 69)', () => {
    const input = createMockInput();
    const decision = evaluatePolicy(input, createMockScore(55));
    expect(decision.decision).toBe('ALLOW');
    expect(decision.action).toBe('CUSTOMER_RECOVERY');
    expect(decision.reasonCode).toBe('MEDIUM_RECOVERY_SCORE');
    expect(decision.ruleTriggered).toBe(16);
  });

  it('Rule 17: Denies recovery for low score (< 40)', () => {
    const input = createMockInput();
    const decision = evaluatePolicy(input, createMockScore(30));
    expect(decision.decision).toBe('DENY');
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reasonCode).toBe('LOW_RECOVERY_SCORE');
    expect(decision.ruleTriggered).toBe(17);
  });
});
