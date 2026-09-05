// Razorpay Test Mode Webhook Integration Service.
// Ingests Razorpay webhook payloads, validates HMAC signatures, maps Razorpay-specific
// attributes to RecoverAI domain schemas, and delegates to the central recoverAI pipeline.
// The existing RecoverAI pipeline remains the sole source of truth and recovery engine.

import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import {
  getCustomerByExternalId,
  createCustomer,
  getPaymentByGatewayPaymentId,
  createPayment,
  type PaymentRecord,
} from '../repositories/index.js';
import {
  processPaymentFailureEvent,
  type PipelineResult,
} from './recoveryPipeline.js';
import type { FailureReason, PaymentMethod } from '../types/domain.js';

export interface RazorpayPaymentEntity {
  id: string;
  entity?: string;
  amount: number; // minor units (paise)
  currency: string;
  status: string;
  order_id?: string;
  invoice_id?: string;
  method?: string;
  email?: string;
  contact?: string;
  customer_id?: string;
  notes?: Record<string, string>;
  error_code?: string;
  error_description?: string;
  error_source?: string;
  error_step?: string;
  error_reason?: string;
  created_at?: number;
}

export interface RazorpayWebhookPayload {
  entity?: string;
  account_id?: string;
  event?: string;
  event_id?: string;
  contains?: string[];
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
  };
  created_at?: number;
  // Allow direct payment object in simple mock payloads
  payment?: RazorpayPaymentEntity;
  merchant_id?: string;
}

/**
 * Verifies Razorpay Webhook HMAC-SHA256 signature against secret.
 * In Test Mode without a configured secret, signature check passes with a warning.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signature?: string,
  secret?: string,
): boolean {
  const webhookSecret = secret ?? process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // If no secret is configured in environment/options (e.g. test mode), permit verification
    return true;
  }

  if (!signature) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    console.error('Error verifying Razorpay webhook signature:', err);
    return false;
  }
}

/**
 * Maps Razorpay error codes and reasons to RecoverAI FailureReason domain enum.
 */
export function mapRazorpayFailureReason(
  errorCode?: string,
  errorDescription?: string,
  errorReason?: string,
): FailureReason {
  // 1. Exact match on Razorpay error_reason
  if (errorReason === 'insufficient_funds') return 'INSUFFICIENT_FUNDS';
  if (errorReason === 'authentication_failed' || errorReason === 'auth_failure') return 'AUTH_FAILURE';
  if (errorReason === 'expired_card') return 'EXPIRED_CARD';
  if (errorReason === 'suspected_fraud') return 'FRAUD_SUSPECTED';
  if (errorReason === 'bank_declined') return 'BANK_DECLINED_GENERIC';
  if (errorReason === 'gateway_error' || errorReason === 'network_error') return 'NETWORK_ERROR';

  // 2. Keyword check on combined error fields
  const combined = [errorCode, errorDescription, errorReason]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    combined.includes('insufficient') ||
    combined.includes('funds') ||
    combined.includes('balance')
  ) {
    return 'INSUFFICIENT_FUNDS';
  }

  if (
    combined.includes('auth') ||
    combined.includes('otp') ||
    combined.includes('2fa') ||
    combined.includes('password')
  ) {
    return 'AUTH_FAILURE';
  }

  if (
    combined.includes('expired') ||
    combined.includes('expiry')
  ) {
    return 'EXPIRED_CARD';
  }

  if (
    combined.includes('fraud') ||
    combined.includes('risk') ||
    combined.includes('blacklisted')
  ) {
    return 'FRAUD_SUSPECTED';
  }

  if (
    combined.includes('declined') ||
    combined.includes('bank') ||
    combined.includes('issuer')
  ) {
    return 'BANK_DECLINED_GENERIC';
  }

  if (
    combined.includes('timeout') ||
    combined.includes('network') ||
    combined.includes('connection') ||
    combined.includes('gateway')
  ) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN';
}

/**
 * Maps Razorpay payment method string to RecoverAI PaymentMethod domain enum.
 */
export function mapRazorpayPaymentMethod(method?: string): PaymentMethod {
  switch (method?.toLowerCase()) {
    case 'card':
      return 'card';
    case 'upi':
      return 'upi';
    case 'netbanking':
      return 'netbanking';
    case 'wallet':
      return 'wallet';
    case 'emi':
    case 'nach':
    case 'emandate':
      return 'emi';
    default:
      return 'card';
  }
}

/**
 * Processes an incoming Razorpay Test Mode Webhook.
 * Converts Razorpay events into RecoverAI payment failure events and executes the standard pipeline.
 */
export async function processRazorpayWebhookEvent(
  rawBody: string,
  payload: RazorpayWebhookPayload,
  signatureHeader?: string,
): Promise<PipelineResult & { razorpayEventHandled: boolean }> {
  // 1. Signature Verification Check
  const isValidSignature = verifyRazorpaySignature(rawBody, signatureHeader);
  if (!isValidSignature) {
    return {
      success: false,
      status: 'RECOVERY_DENIED',
      paymentId: '',
      gatewayEventId: '',
      razorpayEventHandled: false,
      message: 'Invalid Razorpay Webhook signature.',
    };
  }

  // 2. Filter Event Type
  const eventName = payload.event ?? 'payment.failed';
  if (eventName !== 'payment.failed') {
    return {
      success: true,
      status: 'PROCESSED',
      paymentId: '',
      gatewayEventId: payload.event_id ?? `event_ignored_${Date.now()}`,
      razorpayEventHandled: false,
      message: `Razorpay event '${eventName}' received and ignored (only payment.failed triggers recovery).`,
    };
  }

  // 3. Extract Razorpay Payment Details
  const paymentEntity: RazorpayPaymentEntity | undefined =
    payload.payload?.payment?.entity ?? payload.payment;

  if (!paymentEntity || !paymentEntity.id) {
    throw new Error('Invalid Razorpay webhook payload: missing payment entity details.');
  }

  const gatewayPaymentId = paymentEntity.id;
  const createdAtUnix = paymentEntity.created_at ?? payload.created_at ?? Math.floor(Date.now() / 1000);
  const gatewayEventId =
    payload.event_id ?? `event_rzp_${gatewayPaymentId}_${createdAtUnix}`;

  // 4. Resolve Merchant ID
  let merchantId =
    paymentEntity.notes?.merchant_id ?? payload.merchant_id;

  if (!merchantId) {
    // Fallback: look up the default merchant in DB
    const firstMerchant = await prisma.merchant.findFirst();
    if (firstMerchant) {
      merchantId = firstMerchant.id;
    } else {
      // Create seed merchant if none exists
      const newMerchant = await prisma.merchant.create({
        data: {
          name: 'Razorpay Test Merchant',
          automationEnabled: true,
        },
      });
      merchantId = newMerchant.id;
    }
  }

  // 5. Resolve Customer Entity
  const externalCustomerId =
    paymentEntity.customer_id ??
    paymentEntity.email ??
    paymentEntity.contact ??
    'cust_rzp_default';

  let customer = await getCustomerByExternalId(merchantId, externalCustomerId);
  if (!customer) {
    customer = await createCustomer({
      merchantId,
      externalCustomerId,
      blocked: false,
    });
  }

  // 6. Map Failure Details & Payment Method
  const failureReason = mapRazorpayFailureReason(
    paymentEntity.error_code,
    paymentEntity.error_description,
    paymentEntity.error_reason,
  );
  const paymentMethod = mapRazorpayPaymentMethod(paymentEntity.method);
  const amountMinor = paymentEntity.amount ?? 0;
  const currency = paymentEntity.currency ?? 'INR';
  const transactionCreatedAt = new Date(createdAtUnix * 1000).toISOString();

  // 7. Ensure Payment Record Exists in Database
  let payment: PaymentRecord | null = await getPaymentByGatewayPaymentId(gatewayPaymentId);

  if (!payment) {
    payment = await createPayment({
      merchantId,
      customerId: customer.id,
      gatewayPaymentId,
      amountMinor,
      currency,
      paymentMethod,
      status: 'failed',
      failureReason,
      transactionCreatedAt,
    });
  }

  // 8. Execute Core RecoverAI Pipeline (Source of Truth)
  const pipelineResult = await processPaymentFailureEvent({
    merchantId,
    gatewayEventId,
    paymentId: payment.id,
    eventReceivedAt: new Date().toISOString(),
    rawPayload: payload as unknown as Record<string, unknown>,
  });

  return {
    ...pipelineResult,
    razorpayEventHandled: true,
  };
}
