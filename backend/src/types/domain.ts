// Domain enums — RecoverAI foundation. No business logic here.

export type PaymentMethod = 'card' | 'upi' | 'netbanking' | 'wallet' | 'emi';

export type CustomerStatus = 'active' | 'blocked' | 'flagged';

export type PaymentStatus = 'pending' | 'failed' | 'succeeded' | 'refunded' | 'recovered';

export type FailureReason =
  | 'NETWORK_ERROR'
  | 'BANK_DECLINED_GENERIC'
  | 'INSUFFICIENT_FUNDS'
  | 'EXPIRED_CARD'
  | 'AUTH_FAILURE'
  | 'FRAUD_SUSPECTED'
  | 'UNKNOWN';

// Type guard helpers (internal validation only — no new business contracts).
export function isPaymentMethod(value: string): value is PaymentMethod {
  return value === 'card' || value === 'upi' || value === 'netbanking' || value === 'wallet' || value === 'emi';
}

export function isCustomerStatus(value: string): value is CustomerStatus {
  return value === 'active' || value === 'blocked' || value === 'flagged';
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return value === 'pending' || value === 'failed' || value === 'succeeded' || value === 'refunded' || value === 'recovered';
}

export function isFailureReason(value: string): value is FailureReason {
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
