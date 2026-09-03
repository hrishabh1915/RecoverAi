// ExecutionContext builder — constructs ExecutionContext from a fresh,
// server-controlled DB read keyed by transactionId.
//
// CRITICAL: No function signature in this file or any repository file
// accepts AIResponse as a parameter alongside execution logic. The AI must
// never reach the action executor directly. ExecutionContext is built
// exclusively from a fresh DB read — never from cached or AI-provided data.
//
// This is a stub — throws "not implemented".

import type { ExecutionContext } from '../types/policy.js';
import { getPaymentForExecution } from './paymentRepository.js';
import { paymentStatusToDomain, paymentMethodToDomain } from '../types/prismaMapping.js';

// Build ExecutionContext from a fresh DB read.
// The future action executor MUST check paymentStatusAtExecution before
// performing any side effect (e.g. abort if 'succeeded' or 'refunded').
export async function buildExecutionContext(
  _transactionId: string,
): Promise<ExecutionContext> {
  // The implementation would call getPaymentForExecution(_transactionId),
  // map the result via paymentStatusToDomain / paymentMethodToDomain,
  // and return ExecutionContext. Stubbed for now.
  void getPaymentForExecution;
  void paymentStatusToDomain;
  void paymentMethodToDomain;
  throw new Error('not implemented');
}
