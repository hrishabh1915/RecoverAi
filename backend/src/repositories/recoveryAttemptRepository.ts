// Recovery attempt repository — DB access layer for in-flight locks and retry tracking.

import { prisma } from '../lib/prisma.js';
import type { RecoveryAttemptStatus } from '../types/prismaMapping.js';

export interface RecoveryAttemptRecord {
  id: string;
  paymentId: string;
  status: RecoveryAttemptStatus;
  retryCount: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

function toRecoveryAttemptRecord(row: {
  id: string;
  paymentId: string;
  status: string;
  retryCount: number;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}): RecoveryAttemptRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    status: row.status as RecoveryAttemptStatus,
    retryCount: row.retryCount,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getActiveAttemptForPayment(
  paymentId: string,
): Promise<RecoveryAttemptRecord | null> {
  const row = await prisma.recoveryAttempt.findFirst({
    where: {
      paymentId,
      status: 'in_flight',
    },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toRecoveryAttemptRecord(row) : null;
}

export async function getAttemptsForPayment(paymentId: string): Promise<RecoveryAttemptRecord[]> {
  const rows = await prisma.recoveryAttempt.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toRecoveryAttemptRecord);
}

export async function createRecoveryAttempt(
  paymentId: string,
  retryCount: number,
  startedAt: string | Date,
): Promise<RecoveryAttemptRecord> {
  // Concurrency guard: check if in_flight attempt already exists
  const existing = await getActiveAttemptForPayment(paymentId);
  if (existing) {
    throw new Error(`CONCURRENT_RECOVERY_ERROR: An in-flight recovery attempt already exists for payment ${paymentId}`);
  }

  const row = await prisma.recoveryAttempt.create({
    data: {
      paymentId,
      status: 'in_flight',
      retryCount,
      startedAt: typeof startedAt === 'string' ? new Date(startedAt) : startedAt,
    },
  });
  return toRecoveryAttemptRecord(row);
}

export async function updateAttemptStatus(
  id: string,
  status: RecoveryAttemptStatus,
  completedAt?: string | Date,
): Promise<RecoveryAttemptRecord> {
  const row = await prisma.recoveryAttempt.update({
    where: { id },
    data: {
      status,
      completedAt: completedAt
        ? typeof completedAt === 'string'
          ? new Date(completedAt)
          : completedAt
        : status === 'completed' || status === 'failed' || status === 'cancelled'
        ? new Date()
        : null,
    },
  });
  return toRecoveryAttemptRecord(row);
}
