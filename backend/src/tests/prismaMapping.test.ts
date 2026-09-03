import { describe, it, expect } from 'vitest';
import {
  paymentStatusToDomain,
  paymentStatusToPrisma,
  failureReasonToDomain,
  failureReasonToPrisma,
  recoveryActionToPrisma,
  recoveryActionFromPrisma,
  policyDecisionTypeToPrisma,
  policyDecisionTypeFromPrisma,
  recoveryAttemptStatusFromPrisma,
  recoveryAttemptStatusToPrisma,
  paymentMethodToDomain,
  isPrismaPaymentStatus,
  isPrismaFailureReason,
  isPrismaRecoveryAttemptStatus,
  isPrismaPolicyDecision,
  isPrismaPolicyAction,
  safeParsePaymentStatus,
  safeParseFailureReason,
  safeParsePaymentMethod,
} from '../types/prismaMapping.js';
import type { RecoveryAction, PolicyDecisionType } from '../types/policy.js';

describe('Prisma Mapping Layer', () => {
  describe('PaymentStatus', () => {
    it('maps all Prisma values to domain', () => {
      expect(paymentStatusToDomain('PENDING')).toBe('pending');
      expect(paymentStatusToDomain('SUCCEEDED')).toBe('succeeded');
      expect(paymentStatusToDomain('FAILED')).toBe('failed');
      expect(paymentStatusToDomain('RECOVERED')).toBe('recovered');
    });

    it('maps domain values to Prisma', () => {
      expect(paymentStatusToPrisma('pending')).toBe('PENDING');
      expect(paymentStatusToPrisma('succeeded')).toBe('SUCCEEDED');
      expect(paymentStatusToPrisma('failed')).toBe('FAILED');
      expect(paymentStatusToPrisma('recovered')).toBe('RECOVERED');
    });

    it('throws for refunded -> Prisma (no equivalent)', () => {
      expect(() => paymentStatusToPrisma('refunded')).toThrow('refunded');
    });
  });

  describe('FailureReason', () => {
    it('round-trips all values', () => {
      const reasons = [
        'NETWORK_ERROR',
        'BANK_DECLINED_GENERIC',
        'INSUFFICIENT_FUNDS',
        'EXPIRED_CARD',
        'AUTH_FAILURE',
        'FRAUD_SUSPECTED',
        'UNKNOWN',
      ] as const;
      for (const r of reasons) {
        expect(failureReasonToDomain(r)).toBe(r);
        expect(failureReasonToPrisma(r)).toBe(r);
      }
    });
  });

  describe('RecoveryAction', () => {
    it('round-trips all values', () => {
      const actions: RecoveryAction[] = ['SMART_RETRY', 'CUSTOMER_RECOVERY', 'HUMAN_REVIEW', 'NO_ACTION'];
      for (const a of actions) {
        expect(recoveryActionToPrisma(a)).toBe(a);
        expect(recoveryActionFromPrisma(a)).toBe(a);
      }
    });
  });

  describe('PolicyDecisionType', () => {
    it('round-trips all values', () => {
      const decisions: PolicyDecisionType[] = ['ALLOW', 'DENY', 'HUMAN_APPROVAL_REQUIRED'];
      for (const d of decisions) {
        expect(policyDecisionTypeToPrisma(d)).toBe(d);
        expect(policyDecisionTypeFromPrisma(d)).toBe(d);
      }
    });
  });

  describe('RecoveryAttemptStatus', () => {
    it('round-trips all values', () => {
      const statuses = ['in_flight', 'completed', 'failed', 'cancelled'] as const;
      for (const s of statuses) {
        expect(recoveryAttemptStatusFromPrisma(s)).toBe(s);
        expect(recoveryAttemptStatusToPrisma(s)).toBe(s);
      }
    });
  });

  describe('PaymentMethod', () => {
    it('maps valid strings to domain', () => {
      expect(paymentMethodToDomain('card')).toBe('card');
      expect(paymentMethodToDomain('upi')).toBe('upi');
      expect(paymentMethodToDomain('netbanking')).toBe('netbanking');
      expect(paymentMethodToDomain('wallet')).toBe('wallet');
      expect(paymentMethodToDomain('emi')).toBe('emi');
    });

    it('throws for invalid method', () => {
      expect(() => paymentMethodToDomain('crypto')).toThrow('Invalid PaymentMethod');
    });
  });

  describe('Type guards', () => {
    it('isPrismaPaymentStatus', () => {
      expect(isPrismaPaymentStatus('PENDING')).toBe(true);
      expect(isPrismaPaymentStatus('RECOVERED')).toBe(true);
      expect(isPrismaPaymentStatus('pending')).toBe(false);
      expect(isPrismaPaymentStatus('invalid')).toBe(false);
    });

    it('isPrismaFailureReason', () => {
      expect(isPrismaFailureReason('NETWORK_ERROR')).toBe(true);
      expect(isPrismaFailureReason('invalid')).toBe(false);
    });

    it('isPrismaRecoveryAttemptStatus', () => {
      expect(isPrismaRecoveryAttemptStatus('in_flight')).toBe(true);
      expect(isPrismaRecoveryAttemptStatus('invalid')).toBe(false);
    });

    it('isPrismaPolicyDecision', () => {
      expect(isPrismaPolicyDecision('ALLOW')).toBe(true);
      expect(isPrismaPolicyDecision('DENY')).toBe(true);
      expect(isPrismaPolicyDecision('HUMAN_APPROVAL_REQUIRED')).toBe(true);
      expect(isPrismaPolicyDecision('invalid')).toBe(false);
    });

    it('isPrismaPolicyAction', () => {
      expect(isPrismaPolicyAction('SMART_RETRY')).toBe(true);
      expect(isPrismaPolicyAction('CUSTOMER_RECOVERY')).toBe(true);
      expect(isPrismaPolicyAction('HUMAN_REVIEW')).toBe(true);
      expect(isPrismaPolicyAction('NO_ACTION')).toBe(true);
      expect(isPrismaPolicyAction('invalid')).toBe(false);
    });
  });

  describe('Safe parse helpers', () => {
    it('safeParsePaymentStatus succeeds for valid, fails for invalid', () => {
      const ok = safeParsePaymentStatus('recovered');
      expect(ok.success).toBe(true);
      if (ok.success) {
        expect(ok.data).toBe('recovered');
      }
      const bad = safeParsePaymentStatus('invalid');
      expect(bad.success).toBe(false);
    });

    it('safeParseFailureReason succeeds for valid, fails for invalid', () => {
      const ok = safeParseFailureReason('FRAUD_SUSPECTED');
      expect(ok.success).toBe(true);
      if (ok.success) {
        expect(ok.data).toBe('FRAUD_SUSPECTED');
      }
      const bad = safeParseFailureReason('invalid');
      expect(bad.success).toBe(false);
    });

    it('safeParsePaymentMethod succeeds for valid, fails for invalid', () => {
      const ok = safeParsePaymentMethod('upi');
      expect(ok.success).toBe(true);
      if (ok.success) {
        expect(ok.data).toBe('upi');
      }
      const bad = safeParsePaymentMethod('invalid');
      expect(bad.success).toBe(false);
    });
  });
});
