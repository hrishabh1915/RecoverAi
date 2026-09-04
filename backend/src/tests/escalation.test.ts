import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createPayment } from '../repositories/paymentRepository.js';
import { insertProcessedEvent } from '../repositories/processedEventRepository.js';
import { insertRecoveryDecision } from '../repositories/recoveryDecisionRepository.js';
import {
  getPendingEscalations,
  approveEscalation,
  rejectEscalation,
} from '../services/escalationService.js';
import { getPaymentAuditTimeline } from '../services/auditTrailService.js';

describe('Human Escalation & Audit Trail Integration', () => {
  const merchantId = 'mer_test_escalation';
  const customerId = 'cust_test_escalation';
  const paymentApproveId = 'tx_test_escalate_approve';
  const paymentRejectId = 'tx_test_escalate_reject';

  let approveDecisionId = '';
  let rejectDecisionId = '';

  beforeAll(async () => {
    // Setup merchant & customer
    await prisma.merchant.upsert({
      where: { id: merchantId },
      update: {},
      create: {
        id: merchantId,
        name: 'Escalation Test Merchant',
        automationEnabled: true,
      },
    });

    await prisma.customer.upsert({
      where: { id: customerId },
      update: {},
      create: {
        id: customerId,
        merchantId,
        externalCustomerId: 'ext_usr_escalate_01',
        blocked: false,
      },
    });

    // 1. Payment for Approval test (> ₹50,000 High Value)
    await createPayment({
      id: paymentApproveId,
      merchantId,
      customerId,
      gatewayPaymentId: 'pay_esc_gw_01',
      amountMinor: BigInt(6500000), // ₹65,000
      currency: 'INR',
      paymentMethod: 'card',
      status: 'failed',
      failureReason: 'NETWORK_ERROR',
      transactionCreatedAt: new Date(),
    });

    const event1 = await insertProcessedEvent(
      merchantId,
      'evt_esc_01',
      paymentApproveId,
      new Date(),
      { event: 'payment.failed' },
    );

    const decision1 = await insertRecoveryDecision({
      paymentId: paymentApproveId,
      recoveryAttemptId: null,
      eventId: event1.id,
      evaluationTime: new Date(),
      scoreBreakdown: {
        total: 90,
        failureReasonScore: 95,
        retryScore: 100,
        recencyScore: 100,
        historyScore: 80,
        confidenceScore: 90,
      },
      policyDecision: {
        decision: 'HUMAN_APPROVAL_REQUIRED',
        action: 'HUMAN_REVIEW',
        reasonCode: 'HIGH_VALUE_REVIEW',
        reason: 'High value transaction requires human approval',
        ruleTriggered: 11,
        aiRecommendationUsed: false,
      },
      aiResponse: {
        diagnosis: 'NETWORK_ERROR',
        confidence: 0.90,
        recommendedAction: 'SMART_RETRY',
        reasoningFactors: ['Transient blip', 'High value ticket'],
      },
      aiValid: true,
    });
    approveDecisionId = decision1.id;

    // 2. Payment for Rejection test (Unknown decline)
    await createPayment({
      id: paymentRejectId,
      merchantId,
      customerId,
      gatewayPaymentId: 'pay_esc_gw_02',
      amountMinor: BigInt(1200000), // ₹12,000
      currency: 'INR',
      paymentMethod: 'upi',
      status: 'failed',
      failureReason: 'UNKNOWN',
      transactionCreatedAt: new Date(),
    });

    const event2 = await insertProcessedEvent(
      merchantId,
      'evt_esc_02',
      paymentRejectId,
      new Date(),
      { event: 'payment.failed' },
    );

    const decision2 = await insertRecoveryDecision({
      paymentId: paymentRejectId,
      recoveryAttemptId: null,
      eventId: event2.id,
      evaluationTime: new Date(),
      scoreBreakdown: {
        total: 45,
        failureReasonScore: 30,
        retryScore: 100,
        recencyScore: 80,
        historyScore: 60,
        confidenceScore: 40,
      },
      policyDecision: {
        decision: 'HUMAN_APPROVAL_REQUIRED',
        action: 'HUMAN_REVIEW',
        reasonCode: 'UNKNOWN_FAILURE',
        reason: 'Unmapped gateway code requires operator inspection',
        ruleTriggered: 14,
        aiRecommendationUsed: false,
      },
      aiResponse: {
        diagnosis: 'UNKNOWN',
        confidence: 0.35,
        recommendedAction: 'HUMAN_REVIEW',
        reasoningFactors: ['Unrecognized error code'],
      },
      aiValid: true,
    });
    rejectDecisionId = decision2.id;
  });

  afterAll(async () => {
    const ids = [paymentApproveId, paymentRejectId];
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.recoveryDecision.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.recoveryAttempt.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.processedEvent.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('lists pending escalations awaiting operator review', async () => {
    const escalations = await getPendingEscalations(merchantId);
    expect(escalations.length).toBeGreaterThanOrEqual(2);

    const approveItem = escalations.find((e) => e.paymentId === paymentApproveId);
    expect(approveItem).toBeDefined();
    expect(approveItem?.amountINR).toBe(65000);
    expect(approveItem?.reasonCode).toBe('HIGH_VALUE_REVIEW');

    const rejectItem = escalations.find((e) => e.paymentId === paymentRejectId);
    expect(rejectItem).toBeDefined();
    expect(rejectItem?.reasonCode).toBe('UNKNOWN_FAILURE');
  });

  it('operator approves escalation: validates execution guard, updates status, and logs audit record', async () => {
    const res = await approveEscalation(approveDecisionId, 'Risk verified with merchant');
    expect(res.success).toBe(true);
    expect(res.action).toBe('APPROVED');
    expect(res.status).toBe('RECOVERED');
    expect(res.recoveredAmountINR).toBe(65000);

    // Verify DB payment status
    const payment = await prisma.payment.findUnique({
      where: { id: paymentApproveId },
    });
    expect(payment?.status).toBe('RECOVERED');
    expect(payment?.recoveredAt).not.toBeNull();

    // Verify Audit Log
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityId: paymentApproveId,
        action: 'ESCALATION_APPROVED',
      },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0]?.actor).toBe('human_operator');

    // Execution guard test: Attempting to approve again fails safely
    const doubleApprove = await approveEscalation(approveDecisionId, 'Attempting double approval');
    expect(doubleApprove.success).toBe(false);
    expect(doubleApprove.status).toBe('ERROR');
    expect(doubleApprove.message).toContain('Execution Guard rejected');
  });

  it('operator rejects escalation: preserves failed status and logs audit record', async () => {
    const res = await rejectEscalation(rejectDecisionId, 'Unverified decline code');
    expect(res.success).toBe(true);
    expect(res.action).toBe('REJECTED');
    expect(res.status).toBe('RECOVERY_STOPPED');

    // Verify DB payment status remains failed
    const payment = await prisma.payment.findUnique({
      where: { id: paymentRejectId },
    });
    expect(payment?.status).toBe('FAILED');

    // Verify Audit Log
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityId: paymentRejectId,
        action: 'ESCALATION_REJECTED',
      },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0]?.actor).toBe('human_operator');
  });

  it('synthesizes complete chronological audit trail timeline', async () => {
    const timeline = await getPaymentAuditTimeline(paymentApproveId);
    expect(timeline).not.toBeNull();
    expect(timeline?.paymentId).toBe(paymentApproveId);
    expect(timeline?.timeline.length).toBeGreaterThanOrEqual(4);

    const stages = timeline?.timeline.map((t) => t.stage);
    expect(stages).toContain('INGESTION');
    expect(stages).toContain('AI_DIAGNOSIS');
    expect(stages).toContain('POLICY_EVALUATION');
    expect(stages).toContain('HUMAN_REVIEW');
    expect(stages).toContain('DISPOSITION');
  });
});
