// ExecutionContext builder — constructs ExecutionContext from a fresh,
// server-controlled DB read keyed by transactionId.
//
// CRITICAL: No function signature in this file or any repository file
// accepts AIResponse as a parameter alongside execution logic. The AI must
// never reach the action executor directly. ExecutionContext is built
// exclusively from a fresh DB read — never from cached or AI-provided data.

import type { ExecutionContext } from '../types/policy.js';
import { getPaymentForExecution } from './paymentRepository.js';
import { paymentStatusToDomain, paymentMethodToDomain } from '../types/prismaMapping.js';

// Build ExecutionContext from a fresh DB read.
// The action executor MUST check paymentStatusAtExecution before
// performing any side effect (e.g. abort if 'succeeded' or 'refunded').
export async function buildExecutionContext(
  transactionId: string,
): Promise<ExecutionContext> {
  const payment = await getPaymentForExecution(transactionId);
  if (!payment) {
    throw new Error(`Payment record not found for transactionId: ${transactionId}`);
  }

  return {
    transactionId: payment.id,
    customerId: payment.customerId,
    amount: Number(payment.amountMinor),
    currency: payment.currency,
    paymentMethod: paymentMethodToDomain(payment.paymentMethod),
    gatewayPaymentId: payment.gatewayPaymentId,
    paymentStatusAtExecution: paymentStatusToDomain(payment.status),
  };
}
