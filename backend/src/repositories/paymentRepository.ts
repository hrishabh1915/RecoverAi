// Payment repository — DB access layer stub.
// All functions throw "not implemented" — no fake/simulated DB calls.
// No function accepts AIResponse alongside execution logic.

import type { PaymentStatus, PaymentMethod, FailureReason } from '../types/domain.js';
import type { PrismaPaymentStatus, PrismaFailureReason } from '../types/prismaMapping.js';

export interface PaymentRecord {
  id: string;
  merchantId: string;
  customerId: string;
  gatewayPaymentId: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  failureReason: FailureReason | null;
  transactionCreatedAt: string;
  recoveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentUpdate {
  status?: PaymentStatus;
  failureReason?: FailureReason | null;
  recoveredAt?: string | null;
}

export function getPaymentById(_id: string): Promise<PaymentRecord | null> {
  throw new Error('not implemented');
}

export function getPaymentsByMerchantAndCustomer(
  _merchantId: string,
  _customerId: string,
): Promise<PaymentRecord[]> {
  throw new Error('not implemented');
}

export function updatePayment(_id: string, _update: PaymentUpdate): Promise<PaymentRecord> {
  throw new Error('not implemented');
}

// Used by the future ExecutionContext builder — raw Prisma-typed read.
export function getPaymentForExecution(
  _transactionId: string,
): Promise<{
  id: string;
  customerId: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: string;
  gatewayPaymentId: string;
  status: PrismaPaymentStatus;
  failureReason: PrismaFailureReason | null;
} | null> {
  throw new Error('not implemented');
}
