import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import {
  mapRazorpayFailureReason,
  mapRazorpayPaymentMethod,
  verifyRazorpaySignature,
  processRazorpayWebhookEvent,
} from '../services/razorpayWebhookService.js';
import { getAuditLogsForEntity, getDecisionsForPayment } from '../repositories/index.js';

describe('Razorpay Test Mode Webhook Integration', () => {
  let testMerchantId: string;

  beforeAll(async () => {
    testMerchantId = 'mer_razorpay_test_001';
    await prisma.merchant.upsert({
      where: { id: testMerchantId },
      update: { automationEnabled: true },
      create: {
        id: testMerchantId,
        name: 'Razorpay Test Merchant',
        automationEnabled: true,
      },
    });
  });

  describe('Failure Reason & Payment Method Mapping', () => {
    it('correctly maps Razorpay error reasons to RecoverAI FailureReason domain enum', () => {
      expect(mapRazorpayFailureReason('BAD_REQUEST_ERROR', 'Insufficient balance in account', 'insufficient_funds')).toBe('INSUFFICIENT_FUNDS');
      expect(mapRazorpayFailureReason('GATEWAY_ERROR', 'OTP validation failed', 'authentication_failed')).toBe('AUTH_FAILURE');
      expect(mapRazorpayFailureReason('BAD_REQUEST_ERROR', 'Card expired', 'expired_card')).toBe('EXPIRED_CARD');
      expect(mapRazorpayFailureReason('BAD_REQUEST_ERROR', 'High risk transaction blocked', 'suspected_fraud')).toBe('FRAUD_SUSPECTED');
      expect(mapRazorpayFailureReason('GATEWAY_ERROR', 'Bank server timed out', 'gateway_error')).toBe('NETWORK_ERROR');
      expect(mapRazorpayFailureReason('GATEWAY_ERROR', 'Payment declined by issuer bank', 'bank_declined')).toBe('BANK_DECLINED_GENERIC');
      expect(mapRazorpayFailureReason('UNKNOWN_ERROR', 'Something went wrong', 'unknown_code')).toBe('UNKNOWN');
    });

    it('correctly maps Razorpay payment methods to RecoverAI PaymentMethod domain enum', () => {
      expect(mapRazorpayPaymentMethod('card')).toBe('card');
      expect(mapRazorpayPaymentMethod('upi')).toBe('upi');
      expect(mapRazorpayPaymentMethod('netbanking')).toBe('netbanking');
      expect(mapRazorpayPaymentMethod('wallet')).toBe('wallet');
      expect(mapRazorpayPaymentMethod('nach')).toBe('emi');
      expect(mapRazorpayPaymentMethod('crypto')).toBe('card');
      expect(mapRazorpayPaymentMethod(undefined)).toBe('card');
    });
  });

  describe('Webhook Signature Verification', () => {
    it('verifies valid HMAC-SHA256 signature when secret is provided', () => {
      const secret = 'rzp_test_secret_12345';
      const body = JSON.stringify({ entity: 'event', event: 'payment.failed' });
      const validSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyRazorpaySignature(body, validSignature, secret)).toBe(true);
    });

    it('rejects tampered or invalid signature when secret is provided', () => {
      const secret = 'rzp_test_secret_12345';
      const body = JSON.stringify({ entity: 'event', event: 'payment.failed' });
      const invalidSignature = 'invalid_signature_hash';

      expect(verifyRazorpaySignature(body, invalidSignature, secret)).toBe(false);
    });
  });

  describe('Webhook Ingestion & Core Pipeline Execution', () => {
    it('ingests Razorpay payment.failed payload and triggers complete RecoverAI pipeline', async () => {
      const testId = Date.now();
      const eventId = `evt_rzp_test_${testId}`;
      const payId = `pay_rzp_failed_${testId}`;
      const custId = `cust_rzp_${testId}`;

      const payload = {
        entity: 'event',
        account_id: 'acc_test_123',
        event: 'payment.failed',
        event_id: eventId,
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: payId,
              entity: 'payment',
              amount: 150000, // ₹1,500.00
              currency: 'INR',
              status: 'failed',
              method: 'upi',
              email: 'razorpay_user@example.com',
              customer_id: custId,
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment failed due to insufficient funds in customer account',
              error_reason: 'insufficient_funds',
              notes: {
                merchant_id: testMerchantId,
              },
              created_at: 1700000000,
            },
          },
        },
        created_at: 1700000000,
      };

      const rawBody = JSON.stringify(payload);
      const result = await processRazorpayWebhookEvent(rawBody, payload);

      expect(result.success).toBe(true);
      expect(result.razorpayEventHandled).toBe(true);
      expect(result.gatewayEventId).toBe(eventId);

      // Verify payment was created in database
      const createdPayment = await prisma.payment.findFirst({
        where: { gatewayPaymentId: payId },
      });
      expect(createdPayment).not.toBeNull();
      expect(createdPayment?.amountMinor).toBe(BigInt(150000));
      expect(createdPayment?.failureReason).toBe('INSUFFICIENT_FUNDS');
      expect(createdPayment?.paymentMethod).toBe('upi');

      // Verify customer record creation
      const createdCustomer = await prisma.customer.findFirst({
        where: { externalCustomerId: custId },
      });
      expect(createdCustomer).not.toBeNull();

      // Verify Recovery Decision was persisted
      const decisions = await getDecisionsForPayment(createdPayment!.id);
      expect(decisions.length).toBe(1);
      expect(decisions[0]?.policyDecision).toBeDefined();

      // Verify Audit Log trail was populated
      const auditLogs = await getAuditLogsForEntity('payment', createdPayment!.id);
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('safely ignores non-failure Razorpay events (e.g. payment.authorized)', async () => {
      const payload = {
        entity: 'event',
        event: 'payment.authorized',
        event_id: 'evt_rzp_auth_001',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_auth_001',
              amount: 50000,
              currency: 'INR',
              status: 'authorized',
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const result = await processRazorpayWebhookEvent(rawBody, payload);

      expect(result.success).toBe(true);
      expect(result.razorpayEventHandled).toBe(false);
      expect(result.message).toContain('ignored');

      // Ensure no payment failure processing or payment DB record was created for authorized event
      const payment = await prisma.payment.findFirst({
        where: { gatewayPaymentId: 'pay_rzp_auth_001' },
      });
      expect(payment).toBeNull();
    });

    it('enforces idempotency on duplicate Razorpay webhook deliveries', async () => {
      const uniqueId = Date.now();
      const payload = {
        entity: 'event',
        event: 'payment.failed',
        event_id: `evt_rzp_duplicate_${uniqueId}`,
        payload: {
          payment: {
            entity: {
              id: `pay_rzp_dup_${uniqueId}`,
              amount: 250000,
              currency: 'INR',
              status: 'failed',
              method: 'card',
              error_reason: 'gateway_error',
              notes: { merchant_id: testMerchantId },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);

      // First delivery
      const firstResult = await processRazorpayWebhookEvent(rawBody, payload);
      expect(firstResult.success).toBe(true);
      expect(firstResult.status).not.toBe('DUPLICATE');

      // Second delivery with identical event_id
      const secondResult = await processRazorpayWebhookEvent(rawBody, payload);
      expect(secondResult.success).toBe(true);
      expect(secondResult.status).toBe('DUPLICATE');
    });
  });
});
