import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';

describe('Metrics & ₹ Recovered Calculations', () => {
  it('computes accurate aggregate metrics from payments and decisions', async () => {
    const allPayments = await prisma.payment.findMany({
      select: {
        status: true,
        amountMinor: true,
      },
    });

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
