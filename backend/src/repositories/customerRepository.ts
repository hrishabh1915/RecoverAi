// Customer repository — DB access layer.
// No function accepts AIResponse alongside execution logic.

import { prisma } from '../lib/prisma.js';
import type { CustomerStatus } from '../types/domain.js';

export interface CustomerRecord {
  id: string;
  merchantId: string;
  externalCustomerId: string;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerState {
  id: string;
  status: CustomerStatus;
  riskFlag: boolean;
  previousSuccessfulPayments: number;
  previousFailedPayments: number;
}

export interface CustomerInsert {
  id?: string;
  merchantId: string;
  externalCustomerId: string;
  blocked?: boolean;
}

function toCustomerRecord(row: {
  id: string;
  merchantId: string;
  externalCustomerId: string;
  blocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomerRecord {
  return {
    id: row.id,
    merchantId: row.merchantId,
    externalCustomerId: row.externalCustomerId,
    blocked: row.blocked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createCustomer(data: CustomerInsert): Promise<CustomerRecord> {
  const row = await prisma.customer.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      merchantId: data.merchantId,
      externalCustomerId: data.externalCustomerId,
      blocked: data.blocked ?? false,
    },
  });
  return toCustomerRecord(row);
}

export async function getCustomerById(id: string): Promise<CustomerRecord | null> {
  const row = await prisma.customer.findUnique({
    where: { id },
  });
  return row ? toCustomerRecord(row) : null;
}

export async function getCustomerByExternalId(
  merchantId: string,
  externalCustomerId: string,
): Promise<CustomerRecord | null> {
  const row = await prisma.customer.findUnique({
    where: {
      merchantId_externalCustomerId: {
        merchantId,
        externalCustomerId,
      },
    },
  });
  return row ? toCustomerRecord(row) : null;
}

export async function getCustomerState(customerId: string): Promise<CustomerState> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      payments: {
        select: {
          status: true,
          failureReason: true,
        },
      },
    },
  });

  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  let successfulCount = 0;
  let failedCount = 0;
  let hasFraudFailure = false;

  for (const p of customer.payments) {
    if (p.status === 'SUCCEEDED' || p.status === 'RECOVERED') {
      successfulCount++;
    } else if (p.status === 'FAILED') {
      failedCount++;
      if (p.failureReason === 'FRAUD_SUSPECTED') {
        hasFraudFailure = true;
      }
    }
  }

  const isBlocked = customer.blocked;
  const isFlagged = hasFraudFailure || (failedCount > 3 && successfulCount === 0);

  const status: CustomerStatus = isBlocked ? 'blocked' : isFlagged ? 'flagged' : 'active';
  const riskFlag = isBlocked || isFlagged;

  return {
    id: customer.id,
    status,
    riskFlag,
    previousSuccessfulPayments: successfulCount,
    previousFailedPayments: failedCount,
  };
}

export async function setCustomerBlocked(id: string, blocked: boolean): Promise<CustomerRecord> {
  const row = await prisma.customer.update({
    where: { id },
    data: { blocked },
  });
  return toCustomerRecord(row);
}
