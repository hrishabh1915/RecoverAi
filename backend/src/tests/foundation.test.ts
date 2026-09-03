import { describe, it, expect } from 'vitest';
import { AIResponseSchema, validateAIResponse } from '../types/ai.js';
import type { AIResponse } from '../types/ai.js';
import { POLICY_CONFIG } from '../config/policyConfig.js';
import type {
  PaymentMethod,
  CustomerStatus,
  PaymentStatus,
  FailureReason,
} from '../types/domain.js';
import {
  isPaymentMethod,
  isCustomerStatus,
  isPaymentStatus,
  isFailureReason,
} from '../types/domain.js';
import type {
  RecoveryAction,
  PolicyDecisionType,
  ReasonCode,
  ScoreBreakdown,
  PolicyInput,
  PolicyDecision,
  ExecutionContext,
} from '../types/policy.js';

describe('Foundation', () => {
  it('TypeScript compiles — type-level assertions for domain types', () => {
    // These assertions exist purely so the compiler exercises every type.
    const _paymentMethod: PaymentMethod = 'card';
    const _customerStatus: CustomerStatus = 'active';
    const _paymentStatus: PaymentStatus = 'pending';
    const _failureReason: FailureReason = 'NETWORK_ERROR';
    const _recoveryAction: RecoveryAction = 'SMART_RETRY';
    const _decisionType: PolicyDecisionType = 'ALLOW';
    const _reasonCode: ReasonCode = 'AUTOMATION_DISABLED';

    expect(_paymentMethod).toBe('card');
    expect(_customerStatus).toBe('active');
    expect(_paymentStatus).toBe('pending');
    expect(_failureReason).toBe('NETWORK_ERROR');
    expect(_recoveryAction).toBe('SMART_RETRY');
    expect(_decisionType).toBe('ALLOW');
    expect(_reasonCode).toBe('AUTOMATION_DISABLED');
  });

  it('type guards work for domain enums', () => {
    expect(isPaymentMethod('card')).toBe(true);
    expect(isPaymentMethod('invalid')).toBe(false);
    expect(isCustomerStatus('blocked')).toBe(true);
    expect(isCustomerStatus('invalid')).toBe(false);
    expect(isPaymentStatus('succeeded')).toBe(true);
    expect(isPaymentStatus('invalid')).toBe(false);
    expect(isFailureReason('FRAUD_SUSPECTED')).toBe(true);
    expect(isFailureReason('invalid')).toBe(false);
  });

  it('PolicyConfig values match Frozen V1 constants exactly', () => {
    expect(POLICY_CONFIG.maxRetryLimit).toBe(3);
    expect(POLICY_CONFIG.cooldownPeriodMinutes).toBe(30);
    expect(POLICY_CONFIG.highValueThresholdMinor).toBe(5_000_000);
    expect(POLICY_CONFIG.staleEventThresholdMinutes).toBe(180);
    expect(POLICY_CONFIG.allowThreshold).toBe(70);
    expect(POLICY_CONFIG.humanReviewThreshold).toBe(40);
    expect(POLICY_CONFIG.lowConfidenceThreshold).toBe(0.5);
    expect(POLICY_CONFIG.scoreWeights.failureReason).toBe(0.35);
    expect(POLICY_CONFIG.scoreWeights.retry).toBe(0.20);
    expect(POLICY_CONFIG.scoreWeights.recency).toBe(0.15);
    expect(POLICY_CONFIG.scoreWeights.history).toBe(0.20);
    expect(POLICY_CONFIG.scoreWeights.confidence).toBe(0.10);
  });

  it('PolicyConfig is frozen', () => {
    expect(Object.isFrozen(POLICY_CONFIG)).toBe(true);
    expect(Object.isFrozen(POLICY_CONFIG.scoreWeights)).toBe(true);
  });

  it('ScoreBreakdown, PolicyInput, PolicyDecision, ExecutionContext compile', () => {
    const _score: ScoreBreakdown = {
      total: 72,
      failureReasonScore: 25,
      retryScore: 15,
      recencyScore: 10,
      historyScore: 14,
      confidenceScore: 8,
    };
    const _decision: PolicyDecision = {
      decision: 'ALLOW',
      action: 'SMART_RETRY',
      reasonCode: 'HIGH_RECOVERY_SCORE',
      reason: 'Score above allow threshold',
      ruleTriggered: 1,
      aiRecommendationUsed: true,
    };
    const _ctx: ExecutionContext = {
      transactionId: 'tx_1',
      customerId: 'cust_1',
      amount: 1000,
      currency: 'INR',
      paymentMethod: 'card',
      gatewayPaymentId: 'gw_1',
      paymentStatusAtExecution: 'pending',
    };
    expect(_score.total).toBe(72);
    expect(_decision.decision).toBe('ALLOW');
    expect(_ctx.paymentStatusAtExecution).toBe('pending');

    // PolicyInput is large; verify it compiles by constructing a full object.
    const _input: PolicyInput = {
      transactionId: 'tx_1',
      customerId: 'cust_1',
      amount: 1000,
      currency: 'INR',
      paymentMethod: 'card',
      failureReason: 'NETWORK_ERROR',
      failureCode: 'NW_500',
      transactionCreatedAt: '2026-01-01T00:00:00Z',
      eventReceivedAt: '2026-01-01T00:01:00Z',
      previousSuccessfulPayments: 5,
      previousFailedPayments: 1,
      customerStatus: 'active',
      customerRiskFlag: false,
      retryCount: 0,
      lastRetryAt: null,
      alreadyRecovered: false,
      aiDiagnosis: 'NETWORK_ERROR',
      aiConfidence: 0.85,
      aiRecommendedAction: 'SMART_RETRY',
      aiReasoningFactors: ['network_blip'],
      aiResponseValid: true,
      recoveryScore: 72,
      riskLevel: 'low',
      highValueFlag: false,
      suspiciousDataFlag: false,
      automationEnabledForMerchant: true,
      idempotencyKey: 'idem_1',
      eventAlreadyProcessed: false,
      inFlightLock: false,
    };
    expect(_input.transactionId).toBe('tx_1');
  });

  it('AIResponseSchema.strict() rejects an object containing a forbidden key ("amount")', () => {
    const payload = {
      diagnosis: 'NETWORK_ERROR',
      confidence: 0.8,
      recommendedAction: 'SMART_RETRY',
      reasoningFactors: ['net'],
      amount: 9999,
    };
    const result = AIResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('AIResponseSchema.strict() rejects an object containing "retryCount"', () => {
    const payload = {
      diagnosis: 'NETWORK_ERROR',
      confidence: 0.8,
      recommendedAction: 'SMART_RETRY',
      reasoningFactors: ['net'],
      retryCount: 3,
    };
    const result = AIResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('AIResponseSchema rejects a diagnosis value outside AIDiagnosis', () => {
    const payload = {
      diagnosis: 'SOMETHING_INVALID',
      confidence: 0.8,
      recommendedAction: 'SMART_RETRY',
      reasoningFactors: ['net'],
    };
    const result = AIResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('AIResponseSchema accepts a valid minimal object and the type matches z.infer', () => {
    const payload = {
      diagnosis: 'INSUFFICIENT_FUNDS',
      confidence: 0.72,
      recommendedAction: 'CUSTOMER_RECOVERY',
      reasoningFactors: ['low_balance', 'retry_eligible'],
    };
    const result = AIResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      const _typed: AIResponse = result.data;
      expect(_typed.diagnosis).toBe('INSUFFICIENT_FUNDS');
      expect(_typed.confidence).toBe(0.72);
    }
  });

  it('validateAIResponse returns success for valid input and failure for invalid', () => {
    const valid = validateAIResponse({
      diagnosis: 'NETWORK_ERROR',
      confidence: 0.9,
      recommendedAction: 'SMART_RETRY',
      reasoningFactors: ['net'],
    });
    expect(valid.success).toBe(true);

    const invalid = validateAIResponse({ diagnosis: 'BAD' });
    expect(invalid.success).toBe(false);
  });
});
