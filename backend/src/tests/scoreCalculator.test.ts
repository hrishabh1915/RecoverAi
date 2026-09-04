import { describe, it, expect } from 'vitest';
import {
  calculateRecoveryScore,
  calculateFailureReasonScore,
  calculateRetryScore,
  calculateRecencyScore,
  calculateHistoryScore,
  calculateConfidenceScore,
} from '../services/scoreCalculator.js';
import type { PolicyInput } from '../types/policy.js';

describe('Score Calculator', () => {
  it('calculates individual component scores accurately', () => {
    expect(calculateFailureReasonScore('NETWORK_ERROR')).toBe(95);
    expect(calculateFailureReasonScore('FRAUD_SUSPECTED')).toBe(0);
    expect(calculateFailureReasonScore('INSUFFICIENT_FUNDS')).toBe(75);

    expect(calculateRetryScore(0)).toBe(100);
    expect(calculateRetryScore(1)).toBe(70);
    expect(calculateRetryScore(3)).toBe(0);

    expect(calculateRecencyScore(2)).toBe(100);
    expect(calculateRecencyScore(25)).toBe(85);
    expect(calculateRecencyScore(200)).toBe(0);

    expect(calculateHistoryScore(10, 0, false)).toBe(100);
    expect(calculateHistoryScore(0, 0, false)).toBe(60);
    expect(calculateHistoryScore(10, 0, true)).toBe(0); // Risk flag zeroed

    expect(calculateConfidenceScore(0.85, true)).toBe(85);
    expect(calculateConfidenceScore(0.85, false)).toBe(0); // Invalid AI zeroed
  });

  it('calculates weighted score breakdown for a high recovery case', () => {
    const input: PolicyInput = {
      transactionId: 'tx_1',
      customerId: 'cust_1',
      amount: 150000,
      currency: 'INR',
      paymentMethod: 'upi',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: '2026-09-01T10:00:00Z',
      eventReceivedAt: '2026-09-01T10:02:00Z',
      previousSuccessfulPayments: 5,
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
      recoveryScore: 0,
      riskLevel: 'low',
      highValueFlag: false,
      suspiciousDataFlag: false,
      automationEnabledForMerchant: true,
      idempotencyKey: 'evt_1',
      eventAlreadyProcessed: false,
      inFlightLock: false,
    };

    const breakdown = calculateRecoveryScore(input);

    expect(breakdown.failureReasonScore).toBe(95);
    expect(breakdown.retryScore).toBe(100);
    expect(breakdown.recencyScore).toBe(100);
    expect(breakdown.historyScore).toBe(100);
    expect(breakdown.confidenceScore).toBe(90);

    // Weighted sum = 95*0.35 + 100*0.20 + 100*0.15 + 100*0.20 + 90*0.10
    // = 33.25 + 20 + 15 + 20 + 9 = 97.25 -> 97
    expect(breakdown.total).toBe(97);
  });
});
