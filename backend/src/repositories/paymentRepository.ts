// Payment repository — DB access layer.
// No function accepts AIResponse alongside execution logic.

import { prisma } from '../lib/prisma.js';
import type { PaymentStatus, PaymentMethod, FailureReason } from '../types/domain.js';
import {
  paymentStatusToDomain,
  paymentStatusToPrisma,
  failureReasonToDomain,
  failureReasonToPrisma,
  paymentMethodToDomain,
  type PrismaPaymentStatus,
  type PrismaFailureReason,
} from '../types/prismaMapping.js';

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

export interface PaymentInsert {
  id?: string;
  merchantId: string;
  customerId: string;
  gatewayPaymentId: string;
  amountMinor: bigint | number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  failureReason?: FailureReason | null;
  transactionCreatedAt: Date | string;
  recoveredAt?: Date | string | null;
}

function toPaymentRecord(row: {
  id: string;
  merchantId: string;
  customerId: string;
  gatewayPaymentId: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: string;
  status: string;
  failureReason: string | null;
  transactionCreatedAt: Date;
  recoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentRecord {
  return {
    id: row.id,
    merchantId: row.merchantId,
    customerId: row.customerId,
    gatewayPaymentId: row.gatewayPaymentId,
    amountMinor: BigInt(row.amountMinor),
    currency: row.currency,
    paymentMethod: paymentMethodToDomain(row.paymentMethod),
    status: paymentStatusToDomain(row.status as PrismaPaymentStatus),
    failureReason: row.failureReason
      ? failureReasonToDomain(row.failureReason as PrismaFailureReason)
      : null,
    transactionCreatedAt: row.transactionCreatedAt.toISOString(),
    recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createPayment(data: PaymentInsert): Promise<PaymentRecord> {
  const row = await prisma.payment.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      merchantId: data.merchantId,
      customerId: data.customerId,
      gatewayPaymentId: data.gatewayPaymentId,
      amountMinor: BigInt(data.amountMinor),
      currency: data.currency,
      paymentMethod: data.paymentMethod,
      status: paymentStatusToPrisma(data.status),
      failureReason: data.failureReason ? failureReasonToPrisma(data.failureReason) : null,
      transactionCreatedAt:
        typeof data.transactionCreatedAt === 'string'
          ? new Date(data.transactionCreatedAt)
          : data.transactionCreatedAt,
      recoveredAt: data.recoveredAt
        ? typeof data.recoveredAt === 'string'
          ? new Date(data.recoveredAt)
          : data.recoveredAt
        : null,
    },
  });
  return toPaymentRecord(row);
}

export async function getPaymentById(id: string): Promise<PaymentRecord | null> {
  const row = await prisma.payment.findUnique({
    where: { id },
  });
  return row ? toPaymentRecord(row) : null;
}

export async function getPaymentsByMerchantAndCustomer(
  merchantId: string,
  customerId: string,
): Promise<PaymentRecord[]> {
  const rows = await prisma.payment.findMany({
    where: { merchantId, customerId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toPaymentRecord);
}

export async function getAllPayments(filters?: {
  merchantId?: string;
  status?: PaymentStatus;
  limit?: number;
}): Promise<PaymentRecord[]> {
  const rows = await prisma.payment.findMany({
    where: {
      ...(filters?.merchantId ? { merchantId: filters.merchantId } : {}),
      ...(filters?.status ? { status: paymentStatusToPrisma(filters.status) } : {}),
    },
    take: filters?.limit ?? 100,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toPaymentRecord);
}

export async function updatePayment(id: string, update: PaymentUpdate): Promise<PaymentRecord> {
  const data: {
    status?: string;
    failureReason?: string | null;
    recoveredAt?: Date | null;
  } = {};

  if (update.status !== undefined) {
    data.status = paymentStatusToPrisma(update.status);
  }
  if (update.failureReason !== undefined) {
    data.failureReason = update.failureReason ? failureReasonToPrisma(update.failureReason) : null;
  }
  if (update.recoveredAt !== undefined) {
    data.recoveredAt = update.recoveredAt ? new Date(update.recoveredAt) : null;
  }

  const row = await prisma.payment.update({
    where: { id },
    data,
  });
  return toPaymentRecord(row);
}

// Used by the ExecutionContext builder — raw DB read keyed strictly by transactionId
export async function getPaymentForExecution(
  transactionId: string,
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
  const row = await prisma.payment.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      customerId: true,
      amountMinor: true,
      currency: true,
      paymentMethod: true,
      gatewayPaymentId: true,
      status: true,
      failureReason: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customerId,
    amountMinor: BigInt(row.amountMinor),
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    gatewayPaymentId: row.gatewayPaymentId,
    status: row.status as PrismaPaymentStatus,
    failureReason: row.failureReason as PrismaFailureReason | null,
  };
}
