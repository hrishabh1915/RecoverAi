import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createPayment, getPaymentById } from '../repositories/paymentRepository.js';
import { createRecoveryAttempt, updateAttemptStatus } from '../repositories/recoveryAttemptRepository.js';
import { processPaymentFailureEvent } from '../services/recoveryPipeline.js';
import { getPendingEscalations, approveEscalation } from '../services/escalationService.js';
import { getPaymentAuditTimeline } from '../services/auditTrailService.js';

describe('RecoverAI End-to-End Comprehensive Lifecycle & Failure Scenarios', () => {
  const merchantId = 'mer_e2e_showcase';

  // Helper to ensure an isolated customer exists
  async function ensureCustomer(id: string, blocked = false) {
    await prisma.customer.upsert({
      where: { id },
      update: { blocked },
      create: {
        id,
        merchantId,
        externalCustomerId: `ext_${id}`,
        blocked,
      },
    });
  }

  beforeAll(async () => {
    // Setup test merchant
    await prisma.merchant.upsert({
      where: { id: merchantId },
      update: {},
      create: {
        id: merchantId,
        name: 'E2E Showcase Merchant',
        automationEnabled: true,
      },
    });
  });

  afterAll(async () => {
    // Clean all E2E test data
    const payments = await prisma.payment.findMany({ where: { merchantId } });
    const pIds = payments.map((p) => p.id);

    await prisma.auditLog.deleteMany({ where: { entityId: { in: pIds } } });
    await prisma.recoveryDecision.deleteMany({ where: { paymentId: { in: pIds } } });
    await prisma.recoveryAttempt.deleteMany({ where: { paymentId: { in: pIds } } });
    await prisma.processedEvent.deleteMany({ where: { paymentId: { in: pIds } } });
    await prisma.payment.deleteMany({ where: { merchantId } });
    await prisma.customer.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect();
  });

  // Scenario 1: Transient Network Error -> Automated Recovery
  it('Scenario 1: Transient Network Error executes autonomous recovery & captures funds', async () => {
    const custId = 'cust_e2e_net';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_network_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_net',
      amountMinor: BigInt(299900), // ₹2,999
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_net_01',
      paymentId,
      rawPayload: {
        event: 'payment.failed',
        error_code: 'NETWORK_ERROR',
        error_description: 'Acquiring bank timeout on UPI rail',
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('RECOVERED');
    expect(result.decision?.decision).toBe('ALLOW');
    expect(result.decision?.action).toBe('SMART_RETRY');
    expect(result.score?.total).toBeGreaterThanOrEqual(70);

    // Verify DB payment status
    const payment = await getPaymentById(paymentId);
    expect(payment?.status).toBe('recovered');
    expect(payment?.recoveredAt).not.toBeNull();

    // Verify timeline
    const timeline = await getPaymentAuditTimeline(paymentId);
    expect(timeline?.timeline.length).toBeGreaterThanOrEqual(4);
  });

  // Scenario 2: Fraud Detection -> Immediate Stop (Zero Money Movement)
  it('Scenario 2: Suspected fraud triggers Rule 6 (FRAUD_BLOCK) with zero retries', async () => {
    const custId = 'cust_e2e_fraud';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_fraud_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_fraud',
      amountMinor: BigInt(1500000), // ₹15,000
      currency: 'INR',
      paymentMethod: 'card',
      status: 'failed',
      failureReason: 'FRAUD_SUSPECTED',
      transactionCreatedAt: new Date(),
    });

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_fraud_01',
      paymentId,
      rawPayload: {
        event: 'payment.failed',
        error_code: 'FRAUD_SUSPECTED',
        error_description: 'Risk engine blocked card velocity',
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('RECOVERY_DENIED');
    expect(result.decision?.decision).toBe('DENY');
    expect(result.decision?.reasonCode).toBe('FRAUD_BLOCK');
    expect(result.decision?.ruleTriggered).toBe(6);

    // Verify DB payment remains FAILED (never recovered)
    const payment = await getPaymentById(paymentId);
    expect(payment?.status).toBe('failed');
    expect(payment?.recoveredAt).toBeNull();

    // Verify audit trail logged fraud prevention
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: paymentId, action: 'RECOVERY_STOPPED' },
    });
    expect(auditLogs.length).toBe(1);
  });

  // Scenario 3: High-Value Ticket (≥ ₹50,000) -> Escalation & Operator Approval
  it('Scenario 3: High-value transaction (₹1,50,000) halts for operator approval and recovers upon sign-off', async () => {
    const custId = 'cust_e2e_highval';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_highval_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_highval',
      amountMinor: BigInt(15000000), // ₹1,50,000
      currency: 'INR',
      paymentMethod: 'netbanking',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    const pipelineRes = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_highval_01',
      paymentId,
      rawPayload: {
        event: 'payment.failed',
        error_code: 'NETWORK_ERROR',
      },
    });

    expect(pipelineRes.status).toBe('HUMAN_REVIEW_REQUIRED');
    expect(pipelineRes.decision?.decision).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(pipelineRes.decision?.reasonCode).toBe('HIGH_VALUE_REVIEW');
    expect(pipelineRes.decision?.ruleTriggered).toBe(11);

    // Verify it appears in pending escalations
    const escalations = await getPendingEscalations(merchantId);
    const item = escalations.find((e) => e.paymentId === paymentId);
    expect(item).toBeDefined();
    expect(item?.amountINR).toBe(150000);

    // Operator approves the escalation
    const approvalRes = await approveEscalation(
      item!.decisionId,
      'Verified with merchant CFO: approved for recovery',
    );

    expect(approvalRes.success).toBe(true);
    expect(approvalRes.status).toBe('RECOVERED');
    expect(approvalRes.recoveredAmountINR).toBe(150000);

    // Verify DB payment status is now RECOVERED
    const payment = await getPaymentById(paymentId);
    expect(payment?.status).toBe('recovered');
  });

  // Scenario 4: Max Retry Limit Reached (3 Retries) -> Stopped
  it('Scenario 4: Stopping rule triggers after 3 failed attempts (RETRY_LIMIT_REACHED)', async () => {
    const custId = 'cust_e2e_limit';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_retry_limit_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_limit',
      amountMinor: BigInt(99900),
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'BANK_DECLINED_GENERIC',
      transactionCreatedAt: new Date(Date.now() - 3600000),
    });

    // Seed 3 prior attempts and mark them failed (no active in-flight lock)
    const att1 = await createRecoveryAttempt(paymentId, 1, new Date(Date.now() - 3000000));
    await updateAttemptStatus(att1.id, 'failed', new Date(Date.now() - 2900000));

    const att2 = await createRecoveryAttempt(paymentId, 2, new Date(Date.now() - 2000000));
    await updateAttemptStatus(att2.id, 'failed', new Date(Date.now() - 1900000));

    const att3 = await createRecoveryAttempt(paymentId, 3, new Date(Date.now() - 1000000));
    await updateAttemptStatus(att3.id, 'failed', new Date(Date.now() - 900000));

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_limit_01',
      paymentId,
      rawPayload: { event: 'payment.failed' },
    });

    expect(result.status).toBe('RECOVERY_DENIED');
    expect(result.decision?.decision).toBe('DENY');
    expect(result.decision?.reasonCode).toBe('RETRY_LIMIT_REACHED');
    expect(result.decision?.ruleTriggered).toBe(7);
  });

  // Scenario 5: Cooldown Active -> Stopped with Eligible Time
  it('Scenario 5: Attempt within 30-minute cooldown window is stopped (COOLDOWN_ACTIVE)', async () => {
    const custId = 'cust_e2e_cool';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_cooldown_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_cool',
      amountMinor: BigInt(99900),
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'BANK_DECLINED_GENERIC',
      transactionCreatedAt: new Date(Date.now() - 1200000),
    });

    // Attempt ran only 10 minutes ago and failed (not in-flight)
    const att = await createRecoveryAttempt(paymentId, 1, new Date(Date.now() - 600000));
    await updateAttemptStatus(att.id, 'failed', new Date(Date.now() - 590000));

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_cool_01',
      paymentId,
      rawPayload: { event: 'payment.failed' },
    });

    expect(result.status).toBe('RECOVERY_DENIED');
    expect(result.decision?.decision).toBe('DENY');
    expect(result.decision?.reasonCode).toBe('COOLDOWN_ACTIVE');
    expect(result.decision?.ruleTriggered).toBe(8);
    expect(result.decision?.retryEligibleAt).toBeDefined();
  });

  // Scenario 6: Stale Webhook Delivery -> Stopped
  it('Scenario 6: Webhook delayed > 180 minutes is rejected as stale (STALE_EVENT)', async () => {
    const custId = 'cust_e2e_stale';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_stale_01';
    const txCreatedAt = new Date(Date.now() - 15000000); // 250 minutes ago
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_stale',
      amountMinor: BigInt(99900),
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: txCreatedAt,
    });

    const result = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_stale_01',
      paymentId,
      eventReceivedAt: new Date().toISOString(), // 250 min delay
      rawPayload: { event: 'payment.failed' },
    });

    expect(result.status).toBe('RECOVERY_DENIED');
    expect(result.decision?.decision).toBe('DENY');
    expect(result.decision?.reasonCode).toBe('STALE_EVENT');
    expect(result.decision?.ruleTriggered).toBe(9);
  });

  // Scenario 7: Webhook Idempotency -> Duplicate Event Safely Ignored
  it('Scenario 7: Duplicate gateway event is safely deduplicated without side effects', async () => {
    const custId = 'cust_e2e_idem';
    await ensureCustomer(custId);

    const paymentId = 'tx_e2e_idempotency_01';
    await createPayment({
      id: paymentId,
      merchantId,
      customerId: custId,
      gatewayPaymentId: 'pay_gw_e2e_idem',
      amountMinor: BigInt(49900),
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    const firstRun = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_duplicate_test',
      paymentId,
      rawPayload: { event: 'payment.failed' },
    });
    expect(firstRun.status).toBe('RECOVERED');

    // Send exact same webhook again
    const secondRun = await processPaymentFailureEvent({
      merchantId,
      gatewayEventId: 'evt_e2e_duplicate_test', // SAME EVENT ID
      paymentId,
      rawPayload: { event: 'payment.failed' },
    });

    expect(secondRun.status).toBe('DUPLICATE');
    expect(secondRun.message).toContain('Duplicate event');
  });
});
