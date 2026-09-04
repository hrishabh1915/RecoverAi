import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import {
  createPayment,
  getPaymentById,
  updatePayment,
  createCustomer,
  getCustomerById,
  getCustomerState,
  isEventProcessed,
  insertProcessedEvent,
  createRecoveryAttempt,
  getActiveAttemptForPayment,
  updateAttemptStatus,
  insertRecoveryDecision,
  getDecisionsForPayment,
  insertAuditLog,
  getAuditLogsForEntity,
  buildExecutionContext,
} from '../repositories/index.js';

describe('Database & Repository Integration', () => {
  const testMerchantId = 'mer_test_integration';
  const testCustomerId = 'cust_test_integration';
  const testPaymentId = 'tx_test_db_01';

  beforeAll(async () => {
    // Ensure test merchant and customer exist
    await prisma.merchant.upsert({
      where: { id: testMerchantId },
      update: {},
      create: {
        id: testMerchantId,
        name: 'Test Merchant',
        automationEnabled: true,
      },
    });

    await prisma.customer.upsert({
      where: { id: testCustomerId },
      update: {},
      create: {
        id: testCustomerId,
        merchantId: testMerchantId,
        externalCustomerId: 'ext_test_user_01',
        blocked: false,
      },
    });
  });

  afterAll(async () => {
    // Clean up test entities
    await prisma.auditLog.deleteMany({ where: { entityId: testPaymentId } });
    await prisma.recoveryDecision.deleteMany({ where: { paymentId: testPaymentId } });
    await prisma.recoveryAttempt.deleteMany({ where: { paymentId: testPaymentId } });
    await prisma.processedEvent.deleteMany({ where: { paymentId: testPaymentId } });
    await prisma.payment.deleteMany({ where: { id: testPaymentId } });
    await prisma.$disconnect();
  });

  it('Payment CRUD operations', async () => {
    const payment = await createPayment({
      id: testPaymentId,
      merchantId: testMerchantId,
      customerId: testCustomerId,
      gatewayPaymentId: 'pay_test_gw_1',
      amountMinor: BigInt(299900), // ₹2,999
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    expect(payment.id).toBe(testPaymentId);
    expect(payment.status).toBe('failed');
    expect(payment.amountMinor).toBe(BigInt(299900));

    const retrieved = await getPaymentById(testPaymentId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.gatewayPaymentId).toBe('pay_test_gw_1');

    const updated = await updatePayment(testPaymentId, {
      status: 'recovered',
      recoveredAt: new Date().toISOString(),
    });
    expect(updated.status).toBe('recovered');
    expect(updated.recoveredAt).toBeDefined();
  });

  it('Customer state aggregation', async () => {
    const state = await getCustomerState(testCustomerId);
    expect(state.id).toBe(testCustomerId);
    expect(state.status).toBe('active');
    expect(state.riskFlag).toBe(false);
  });

  it('Processed event idempotency handling', async () => {
    const gatewayEventId = 'evt_test_idempotency_1';

    const before = await isEventProcessed(testMerchantId, gatewayEventId);
    expect(before).toBe(false);

    const inserted = await insertProcessedEvent(
      testMerchantId,
      gatewayEventId,
      testPaymentId,
      new Date(),
      { event: 'payment.failed' },
    );
    expect(inserted.gatewayEventId).toBe(gatewayEventId);

    const after = await isEventProcessed(testMerchantId, gatewayEventId);
    expect(after).toBe(true);
  });

  it('Recovery attempt and concurrency guard', async () => {
    const attempt = await createRecoveryAttempt(testPaymentId, 1, new Date());
    expect(attempt.status).toBe('in_flight');
    expect(attempt.retryCount).toBe(1);

    const active = await getActiveAttemptForPayment(testPaymentId);
    expect(active?.id).toBe(attempt.id);

    // Concurrency guard: attempting another in_flight attempt throws
    await expect(createRecoveryAttempt(testPaymentId, 2, new Date())).rejects.toThrow(
      'CONCURRENT_RECOVERY_ERROR',
    );

    const completed = await updateAttemptStatus(attempt.id, 'completed', new Date());
    expect(completed.status).toBe('completed');
  });

  it('Recovery decision persistence and retrieval', async () => {
    const processedEvent = await insertProcessedEvent(
      testMerchantId,
      'evt_test_decision_gw_1',
      testPaymentId,
      new Date(),
      { event: 'payment.failed' },
    );

    const decision = await insertRecoveryDecision({
      paymentId: testPaymentId,
      recoveryAttemptId: null,
      eventId: processedEvent.id,
      evaluationTime: new Date(),
      scoreBreakdown: {
        total: 82,
        failureReasonScore: 95,
        retryScore: 100,
        recencyScore: 85,
        historyScore: 60,
        confidenceScore: 80,
      },
      policyDecision: {
        decision: 'ALLOW',
        action: 'SMART_RETRY',
        reasonCode: 'HIGH_RECOVERY_SCORE',
        reason: 'Score above threshold',
        ruleTriggered: 15,
        aiRecommendationUsed: true,
      },
      aiResponse: {
        diagnosis: 'NETWORK_ERROR',
        confidence: 0.88,
        recommendedAction: 'SMART_RETRY',
        reasoningFactors: ['transient_error'],
      },
      aiValid: true,
    });

    expect(decision.recoveryScore).toBe(82);
    expect(decision.policyDecision).toBe('ALLOW');

    const decisions = await getDecisionsForPayment(testPaymentId);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0]?.aiResponse?.diagnosis).toBe('NETWORK_ERROR');
  });

  it('Audit logging append-only trail', async () => {
    const log = await insertAuditLog({
      entityType: 'payment',
      entityId: testPaymentId,
      action: 'PAYMENT_RECOVERY_TEST',
      actor: 'test_suite',
      details: { test: true },
    });

    expect(log.action).toBe('PAYMENT_RECOVERY_TEST');
    expect(log.actor).toBe('test_suite');

    const logs = await getAuditLogsForEntity('payment', testPaymentId);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('ExecutionContextBuilder creates context strictly from live DB', async () => {
    const ctx = await buildExecutionContext(testPaymentId);
    expect(ctx.transactionId).toBe(testPaymentId);
    expect(ctx.customerId).toBe(testCustomerId);
    expect(ctx.currency).toBe('INR');
    expect(ctx.paymentMethod).toBe('upi');
    expect(ctx.paymentStatusAtExecution).toBe('recovered');
  });
});
