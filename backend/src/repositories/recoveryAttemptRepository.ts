// Recovery attempt repository — DB access layer stub for in-flight locks.
// All functions throw "not implemented" — no fake/simulated DB calls.

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

export function getActiveAttemptForPayment(
  _paymentId: string,
): Promise<RecoveryAttemptRecord | null> {
  throw new Error('not implemented');
}

export function getAttemptsForPayment(_paymentId: string): Promise<RecoveryAttemptRecord[]> {
  throw new Error('not implemented');
}

export function createRecoveryAttempt(
  _paymentId: string,
  _retryCount: number,
  _startedAt: string,
): Promise<RecoveryAttemptRecord> {
  throw new Error('not implemented');
}

export function updateAttemptStatus(
  _id: string,
  _status: RecoveryAttemptStatus,
  _completedAt?: string,
): Promise<RecoveryAttemptRecord> {
  throw new Error('not implemented');
}
