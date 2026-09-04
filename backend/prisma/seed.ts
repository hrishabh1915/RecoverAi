// Seed script — generates exactly 100 synthetic failed payment events with varied risk,
// amounts, failure reasons, and recovery outcomes.
// All data is explicitly labeled as SYNTHETIC_DEMO.

import { prisma } from '../src/lib/prisma.js';
import { createPayment } from '../src/repositories/paymentRepository.js';
import { processPaymentFailureEvent } from '../src/services/recoveryPipeline.js';
import type { FailureReason, PaymentMethod } from '../src/types/domain.js';

const FAILURE_REASONS: FailureReason[] = [
  'NETWORK_ERROR',          // 30% - Highly recoverable
  'INSUFFICIENT_FUNDS',     // 25% - Recoverable via customer notification
  'BANK_DECLINED_GENERIC',  // 20% - Moderately recoverable
  'AUTH_FAILURE',           // 10% - Needs fresh 3DS/OTP
  'EXPIRED_CARD',           // 7%  - Customer update needed
  'FRAUD_SUSPECTED',        // 5%  - Must be stopped by policy
  'UNKNOWN',                // 3%  - Escalated to human review
];

const PAYMENT_METHODS: PaymentMethod[] = ['upi', 'card', 'netbanking', 'wallet', 'emi'];

async function seed() {
  console.log('🌱 Starting RecoverAI Synthetic Demo Seed (100 Payments)...');

  // Clean existing tables to avoid duplicate key conflicts during re-seed
  await prisma.auditLog.deleteMany();
  await prisma.recoveryDecision.deleteMany();
  await prisma.recoveryAttempt.deleteMany();
  await prisma.processedEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.merchant.deleteMany();

  // 1. Create Demo Merchant
  const merchant = await prisma.merchant.create({
    data: {
      id: 'mer_recoverai_demo',
      name: 'Acme SaaS India (Demo)',
      automationEnabled: true,
    },
  });
  console.log(`✓ Created merchant: ${merchant.name} (${merchant.id})`);

  // 2. Create 25 Synthetic Customers with varied risk/behavior profiles
  const customers = [];
  for (let i = 1; i <= 25; i++) {
    const isBlocked = i === 13 || i === 24; // 2 blocked customers
    const customer = await prisma.customer.create({
      data: {
        id: `cust_demo_${i.toString().padStart(3, '0')}`,
        merchantId: merchant.id,
        externalCustomerId: `ext_usr_${1000 + i}`,
        blocked: isBlocked,
      },
    });
    customers.push(customer);
  }
  console.log(`✓ Created ${customers.length} synthetic customers`);

  // 3. Create Seed Historical Payments for some customers so History score is realistic
  for (let i = 0; i < 15; i++) {
    const cust = customers[i]!;
    // 1-4 previous successful payments
    const successfulCount = (i % 4) + 1;
    for (let s = 0; s < successfulCount; s++) {
      await createPayment({
        id: `tx_hist_succ_${i}_${s}`,
        merchantId: merchant.id,
        customerId: cust.id,
        gatewayPaymentId: `pay_hist_${i}_${s}`,
        amountMinor: BigInt(99900), // ₹999
        currency: 'INR',
        paymentMethod: 'upi',
        status: 'succeeded',
        transactionCreatedAt: new Date(Date.now() - (40 + s * 5) * 86400000),
      });
    }
  }

  // 4. Generate exactly 100 Failed Payments
  console.log('⚡ Generating & processing 100 failed payment events...');

  const results = {
    total: 100,
    recovered: 0,
    humanReview: 0,
    denied: 0,
    totalAtRiskINR: 0,
    simulatedRecoveredINR: 0,
  };

  const amountsINR = [
    199, 499, 999, 1499, 2999, 4999, 9999, 14999, 24999, 39999,
    65000, 120000, 185000, // High-value test cases (> ₹50,000 threshold)
  ];

  for (let i = 1; i <= 100; i++) {
    const customer = customers[(i - 1) % customers.length]!;
    const method = PAYMENT_METHODS[i % PAYMENT_METHODS.length]!;

    // Distribute failure reasons realistically
    let reason: FailureReason;
    if (i <= 30) reason = 'NETWORK_ERROR';
    else if (i <= 55) reason = 'INSUFFICIENT_FUNDS';
    else if (i <= 75) reason = 'BANK_DECLINED_GENERIC';
    else if (i <= 85) reason = 'AUTH_FAILURE';
    else if (i <= 92) reason = 'EXPIRED_CARD';
    else if (i <= 97) reason = 'FRAUD_SUSPECTED';
    else reason = 'UNKNOWN';

    // Amount distribution (occasional high-value transactions)
    const amountINR = i % 12 === 0 ? amountsINR[10 + (i % 3)]! : amountsINR[i % 10]!;
    const amountMinor = BigInt(amountINR * 100);

    // Timestamp spread over the last 14 days
    const daysAgo = (i % 14);
    const minutesAgo = (i * 17) % 1440;
    const txCreatedAt = new Date(Date.now() - (daysAgo * 86400000 + minutesAgo * 60000));

    // Event delivery delay (some fresh, some stale for testing rule 9)
    const delayMinutes = i === 42 || i === 88 ? 240 : (i % 15) + 1; // 2 intentional stale events
    const eventReceivedAt = new Date(txCreatedAt.getTime() + delayMinutes * 60000);

    const paymentId = `tx_demo_${i.toString().padStart(3, '0')}`;
    const gatewayPaymentId = `pay_razorpay_sim_${100000 + i}`;
    const gatewayEventId = `evt_failed_${200000 + i}`;

    // Create payment in FAILED state
    await createPayment({
      id: paymentId,
      merchantId: merchant.id,
      customerId: customer.id,
      gatewayPaymentId,
      amountMinor,
      currency: 'INR',
      paymentMethod: method,
      status: 'failed',
      failureReason: reason,
      transactionCreatedAt: txCreatedAt,
    });

    results.totalAtRiskINR += amountINR;

    // Process event through Recovery Pipeline
    const pipelineRes = await processPaymentFailureEvent({
      merchantId: merchant.id,
      gatewayEventId,
      paymentId,
      eventReceivedAt: eventReceivedAt.toISOString(),
      rawPayload: {
        synthetic_demo_marker: true,
        source: 'Razorpay_Webhook_Simulated',
        event: 'payment.failed',
        entity: {
          id: gatewayPaymentId,
          amount: amountINR * 100,
          currency: 'INR',
          status: 'failed',
          method,
          error_code: reason,
          error_description: `Simulated gateway decline: ${reason}`,
        },
      },
    });

    if (pipelineRes.status === 'RECOVERED') {
      results.recovered++;
      results.simulatedRecoveredINR += amountINR;
    } else if (pipelineRes.status === 'HUMAN_REVIEW_REQUIRED') {
      results.humanReview++;
    } else {
      results.denied++;
    }
  }

  console.log('\n📊 ── DEMO SEED RESULTS ──────────────────────────────────────────');
  console.log(` Total Failed Payments Processed : ${results.total}`);
  console.log(` Total At-Risk Revenue           : ₹${results.totalAtRiskINR.toLocaleString('en-IN')}`);
  console.log(` Simulated Revenue Recovered     : ₹${results.simulatedRecoveredINR.toLocaleString('en-IN')}`);
  console.log(` Automated Recoveries            : ${results.recovered}`);
  console.log(` Human Approvals Queued          : ${results.humanReview}`);
  console.log(` Denied / Stopped                : ${results.denied}`);
  console.log(` Recovery Rate                   : ${Math.round((results.recovered / results.total) * 100)}%`);
  console.log('──────────────────────────────────────────────────────────────────\n');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
