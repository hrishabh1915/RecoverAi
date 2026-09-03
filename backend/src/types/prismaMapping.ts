// Enum mapping layer — bridges Prisma DB enum values and domain types.
// Pure functions only. No business logic, no DB access.

import type {
  PaymentStatus,
  FailureReason,
  PaymentMethod,
} from './domain.js';
import type { RecoveryAction, PolicyDecisionType } from './policy.js';
import {
  isPaymentStatus,
  isFailureReason,
  isPaymentMethod,
} from './domain.js';

// ---------------------------------------------------------------------------
// Prisma-side enum value types (mirror the Prisma schema exactly)
// ---------------------------------------------------------------------------

export type PrismaPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'RECOVERED';

export type PrismaFailureReason =
  | 'NETWORK_ERROR'
  | 'BANK_DECLINED_GENERIC'
  | 'INSUFFICIENT_FUNDS'
  | 'EXPIRED_CARD'
  | 'AUTH_FAILURE'
  | 'FRAUD_SUSPECTED'
  | 'UNKNOWN';

export type PrismaRecoveryAttemptStatus = 'in_flight' | 'completed' | 'failed' | 'cancelled';

export type PrismaPolicyDecision = 'ALLOW' | 'DENY' | 'HUMAN_APPROVAL_REQUIRED';

export type PrismaPolicyAction = 'SMART_RETRY' | 'CUSTOMER_RECOVERY' | 'HUMAN_REVIEW' | 'NO_ACTION';

export type RecoveryAttemptStatus = 'in_flight' | 'completed' | 'failed' | 'cancelled';

// ---------------------------------------------------------------------------
// Type guards for Prisma-side values
// ---------------------------------------------------------------------------

export function isPrismaPaymentStatus(value: string): value is PrismaPaymentStatus {
  return value === 'PENDING' || value === 'SUCCEEDED' || value === 'FAILED' || value === 'RECOVERED';
}

export function isPrismaFailureReason(value: string): value is PrismaFailureReason {
  return (
    value === 'NETWORK_ERROR' ||
    value === 'BANK_DECLINED_GENERIC' ||
    value === 'INSUFFICIENT_FUNDS' ||
    value === 'EXPIRED_CARD' ||
    value === 'AUTH_FAILURE' ||
    value === 'FRAUD_SUSPECTED' ||
    value === 'UNKNOWN'
  );
}

export function isPrismaRecoveryAttemptStatus(value: string): value is PrismaRecoveryAttemptStatus {
  return value === 'in_flight' || value === 'completed' || value === 'failed' || value === 'cancelled';
}

export function isPrismaPolicyDecision(value: string): value is PrismaPolicyDecision {
  return value === 'ALLOW' || value === 'DENY' || value === 'HUMAN_APPROVAL_REQUIRED';
}

export function isPrismaPolicyAction(value: string): value is PrismaPolicyAction {
  return value === 'SMART_RETRY' || value === 'CUSTOMER_RECOVERY' || value === 'HUMAN_REVIEW' || value === 'NO_ACTION';
}

// ---------------------------------------------------------------------------
// PaymentStatus: Prisma (uppercase) ↔ Domain (lowercase)
// RECOVERED -> 'recovered', PENDING -> 'pending', etc.
// ---------------------------------------------------------------------------

const paymentStatusToDomainMap: Record<PrismaPaymentStatus, PaymentStatus> = {
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  RECOVERED: 'recovered',
};

export function paymentStatusToDomain(value: PrismaPaymentStatus): PaymentStatus {
  return paymentStatusToDomainMap[value];
}

// 'refunded' has no Prisma equivalent in the current schema — it is a
// domain-only state. Converting it to Prisma is an error, not a silent
// fallback to FAILED.
export function paymentStatusToPrisma(value: PaymentStatus): PrismaPaymentStatus {
  switch (value) {
    case 'pending':
      return 'PENDING';
    case 'succeeded':
      return 'SUCCEEDED';
    case 'failed':
      return 'FAILED';
    case 'recovered':
      return 'RECOVERED';
    case 'refunded':
      throw new Error("PaymentStatus 'refunded' has no Prisma equivalent");
  }
}

// ---------------------------------------------------------------------------
// FailureReason: identical in both worlds (uppercase)
// ---------------------------------------------------------------------------

export function failureReasonToDomain(value: PrismaFailureReason): FailureReason {
  return value;
}

export function failureReasonToPrisma(value: FailureReason): PrismaFailureReason {
  return value;
}

// ---------------------------------------------------------------------------
// RecoveryAction / PolicyAction: identical in both worlds (uppercase)
// ---------------------------------------------------------------------------

export function recoveryActionToPrisma(value: RecoveryAction): PrismaPolicyAction {
  return value;
}

export function recoveryActionFromPrisma(value: PrismaPolicyAction): RecoveryAction {
  return value;
}

// ---------------------------------------------------------------------------
// PolicyDecisionType / PolicyDecision: identical in both worlds (uppercase)
// ---------------------------------------------------------------------------

export function policyDecisionTypeToPrisma(value: PolicyDecisionType): PrismaPolicyDecision {
  return value;
}

export function policyDecisionTypeFromPrisma(value: PrismaPolicyDecision): PolicyDecisionType {
  return value;
}

// ---------------------------------------------------------------------------
// RecoveryAttemptStatus: identical in both worlds (lowercase)
// ---------------------------------------------------------------------------

export function recoveryAttemptStatusFromPrisma(value: PrismaRecoveryAttemptStatus): RecoveryAttemptStatus {
  return value;
}

export function recoveryAttemptStatusToPrisma(value: RecoveryAttemptStatus): PrismaRecoveryAttemptStatus {
  return value;
}

// ---------------------------------------------------------------------------
// PaymentMethod: stored as plain string in Prisma, typed as union in domain.
// Uses the existing domain type guard for validation.
// ---------------------------------------------------------------------------

export function paymentMethodToDomain(value: string): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new Error(`Invalid PaymentMethod: ${value}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Safe parse helpers — return typed result objects instead of throwing.
// Useful at boundaries where invalid data should be handled, not thrown.
// ---------------------------------------------------------------------------

export type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function safeParsePaymentStatus(value: string): SafeResult<PaymentStatus> {
  if (isPaymentStatus(value)) {
    return { success: true, data: value };
  }
  return { success: false, error: `Invalid PaymentStatus: ${value}` };
}

export function safeParseFailureReason(value: string): SafeResult<FailureReason> {
  if (isFailureReason(value)) {
    return { success: true, data: value };
  }
  return { success: false, error: `Invalid FailureReason: ${value}` };
}

export function safeParsePaymentMethod(value: string): SafeResult<PaymentMethod> {
  if (isPaymentMethod(value)) {
    return { success: true, data: value };
  }
  return { success: false, error: `Invalid PaymentMethod: ${value}` };
}
