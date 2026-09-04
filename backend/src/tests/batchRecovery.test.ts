import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createPayment } from '../repositories/paymentRepository.js';
import { processBatchRecovery } from '../services/batchRecoveryService.js';

describe('Batch Recovery Engine', () => {
  const merchantId = 'mer_test_batch';
  const customerNetworkId = 'cust_test_batch_network';
  const customerFraudId = 'cust_test_batch_fraud';
  const customerBlockedId = 'cust_test_batch_blocked';
  const customerHighValId = 'cust_test_batch_highval';

  const paymentIds = [
    'tx_test_batch_01', // NETWORK_ERROR (Clean customer, Recoverable)
    'tx_test_batch_02', // FRAUD_SUSPECTED (Fraud customer, Should be stopped)
    'tx_test_batch_03', // Blocked customer (Should be stopped)
    'tx_test_batch_04', // High value > 50k (Clean customer, Human review)
  ];

  beforeAll(async () => {
    // Setup merchant
    await prisma.merchant.upsert({
      where: { id: merchantId },
      update: {},
      create: {
        id: merchantId,
        name: 'Batch Test Merchant',
        automationEnabled: true,
      },
    });

    // Setup isolated customers for clean test scenario separation
    await prisma.customer.upsert({
      where: { id: customerNetworkId },
      update: {},
      create: {
        id: customerNetworkId,
        merchantId,
        externalCustomerId: 'ext_batch_network',
        blocked: false,
      },
    });

    await prisma.customer.upsert({
      where: { id: customerFraudId },
      update: {},
      create: {
        id: customerFraudId,
        merchantId,
        externalCustomerId: 'ext_batch_fraud',
        blocked: false,
      },
    });

    await prisma.customer.upsert({
      where: { id: customerBlockedId },
      update: {},
      create: {
        id: customerBlockedId,
        merchantId,
        externalCustomerId: 'ext_batch_blocked',
        blocked: true,
      },
    });

    await prisma.customer.upsert({
      where: { id: customerHighValId },
      update: {},
      create: {
        id: customerHighValId,
        merchantId,
        externalCustomerId: 'ext_batch_highval',
        blocked: false,
      },
    });

    // 1. Recoverable Network Error
    await createPayment({
      id: paymentIds[0]!,
      merchantId,
      customerId: customerNetworkId,
      gatewayPaymentId: 'pay_gw_batch_01',
      amountMinor: BigInt(149900), // ₹1,499
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    // 2. Fraud decline
    await createPayment({
      id: paymentIds[1]!,
      merchantId,
      customerId: customerFraudId,
      gatewayPaymentId: 'pay_gw_batch_02',
      amountMinor: BigInt(299900), // ₹2,999
      currency: 'INR',
      paymentMethod: 'card',
      status: 'failed',
      failureReason: 'FRAUD_SUSPECTED',
      transactionCreatedAt: new Date(),
    });

    // 3. Blocked customer
    await createPayment({
      id: paymentIds[2]!,
      merchantId,
      customerId: customerBlockedId,
      gatewayPaymentId: 'pay_gw_batch_03',
      amountMinor: BigInt(99900), // ₹999
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    // 4. High value payment (> ₹50,000)
    await createPayment({
      id: paymentIds[3]!,
      merchantId,
      customerId: customerHighValId,
      gatewayPaymentId: 'pay_gw_batch_04',
      amountMinor: BigInt(7500000), // ₹75,000 (HIGH VALUE)
      currency: 'INR',
      paymentMethod: 'netbanking',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.auditLog.deleteMany({ where: { entityId: { in: paymentIds } } });
    await prisma.recoveryDecision.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.recoveryAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.processedEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.$disconnect();
  });

  it('Dry-Run Mode: evaluates batch without altering payment records in DB', async () => {
    const result = await processBatchRecovery({
      merchantId,
      paymentIds,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalProcessed).toBe(4);
    expect(result.totalAtRiskINR).toBe(1499 + 2999 + 999 + 75000);

    // Verify DB payments remain strictly 'failed' in dry-run
    const dbPayments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
    });
    for (const p of dbPayments) {
      expect(p.status).toBe('FAILED');
    }

    // Verify item breakdown
    const networkItem = result.items.find((i) => i.paymentId === paymentIds[0]);
    expect(networkItem?.policyDecision).toBe('ALLOW');
    expect(networkItem?.policyAction).toBe('SMART_RETRY');

    const fraudItem = result.items.find((i) => i.paymentId === paymentIds[1]);
    expect(fraudItem?.policyDecision).toBe('DENY');
    expect(fraudItem?.reasonCode).toBe('FRAUD_BLOCK');

    const blockedItem = result.items.find((i) => i.paymentId === paymentIds[2]);
    expect(blockedItem?.policyDecision).toBe('DENY');
    expect(blockedItem?.reasonCode).toBe('CUSTOMER_BLOCKED');

    const highValItem = result.items.find((i) => i.paymentId === paymentIds[3]);
    expect(highValItem?.policyDecision).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(highValItem?.reasonCode).toBe('HIGH_VALUE_REVIEW');
  });

  it('Live Mode: processes batch, mutates DB records, and logs audit events', async () => {
    const result = await processBatchRecovery({
      merchantId,
      paymentIds: [paymentIds[0]!, paymentIds[1]!], // 1 network error, 1 fraud
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.totalProcessed).toBe(2);

    // Verify network error payment was recovered
    const recoveredPayment = await prisma.payment.findUnique({
      where: { id: paymentIds[0] },
    });
    expect(recoveredPayment?.status).toBe('RECOVERED');
    expect(recoveredPayment?.recoveredAt).not.toBeNull();

    // Verify fraud payment remained failed
    const fraudPayment = await prisma.payment.findUnique({
      where: { id: paymentIds[1] },
    });
    expect(fraudPayment?.status).toBe('FAILED');

    // Verify audit logs were persisted for the live batch
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: paymentIds[0] },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });
});
