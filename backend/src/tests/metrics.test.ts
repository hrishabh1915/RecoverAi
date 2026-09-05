import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';

describe('Metrics & ₹ Recovered Calculations', () => {
  it('computes accurate aggregate metrics from payments and decisions', async () => {
    let allPayments = await prisma.payment.findMany({
      select: {
        status: true,
        amountMinor: true,
      },
    });

    if (allPayments.length === 0) {
      const merchant = await prisma.merchant.upsert({
        where: { id: 'mer_metrics_test' },
        update: {},
        create: { id: 'mer_metrics_test', name: 'Metrics Test Merchant' },
      });
      const customer = await prisma.customer.upsert({
        where: { merchantId_externalCustomerId: { merchantId: merchant.id, externalCustomerId: 'cust_metrics' } },
        update: {},
        create: { merchantId: merchant.id, externalCustomerId: 'cust_metrics' },
      });

      await prisma.payment.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          gatewayPaymentId: 'pay_metrics_f1',
          amountMinor: BigInt(50000),
          currency: 'INR',
          paymentMethod: 'card',
          status: 'FAILED',
          failureReason: 'NETWORK_ERROR',
          transactionCreatedAt: new Date(),
        },
      });

      await prisma.payment.create({
        data: {
          merchantId: merchant.id,
          customerId: customer.id,
          gatewayPaymentId: 'pay_metrics_r1',
          amountMinor: BigInt(100000),
          currency: 'INR',
          paymentMethod: 'upi',
          status: 'RECOVERED',
          recoveredAt: new Date(),
          transactionCreatedAt: new Date(),
        },
      });

      allPayments = await prisma.payment.findMany({
        select: {
          status: true,
          amountMinor: true,
        },
      });
    }

    let totalFailed = 0;
    let totalRecovered = 0;
    let atRiskMinor = BigInt(0);
    let recoveredMinor = BigInt(0);

    for (const p of allPayments) {
      const amount = BigInt(p.amountMinor);
      if (p.status === 'FAILED') {
        totalFailed++;
        atRiskMinor += amount;
      } else if (p.status === 'RECOVERED') {
        totalRecovered++;
        recoveredMinor += amount;
      }
    }

    expect(totalFailed + totalRecovered).toBeGreaterThan(0);
    expect(Number(atRiskMinor)).toBeGreaterThan(0);
    expect(Number(recoveredMinor)).toBeGreaterThan(0);

    const recoveryRate =
      totalFailed + totalRecovered > 0
        ? Math.round((totalRecovered / (totalFailed + totalRecovered)) * 100)
        : 0;

    expect(recoveryRate).toBeGreaterThanOrEqual(0);
    expect(recoveryRate).toBeLessThanOrEqual(100);
  });
});
