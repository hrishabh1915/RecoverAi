// Processed event repository — DB access layer for idempotency.
// Enforces that the same gateway event is not processed twice.

import { prisma } from '../lib/prisma.js';

export interface ProcessedEventRecord {
  id: string;
  merchantId: string;
  gatewayEventId: string;
  paymentId: string;
  eventReceivedAt: string;
  rawPayload: unknown;
  createdAt: string;
}

function toProcessedEventRecord(row: {
  id: string;
  merchantId: string;
  gatewayEventId: string;
  paymentId: string;
  eventReceivedAt: Date;
  rawPayload: string;
  createdAt: Date;
}): ProcessedEventRecord {
  let parsedPayload: unknown = row.rawPayload;
  try {
    parsedPayload = JSON.parse(row.rawPayload);
  } catch {
    // Keep as string if not JSON
  }

  return {
    id: row.id,
    merchantId: row.merchantId,
    gatewayEventId: row.gatewayEventId,
    paymentId: row.paymentId,
    eventReceivedAt: row.eventReceivedAt.toISOString(),
    rawPayload: parsedPayload,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function isEventProcessed(
  merchantId: string,
  gatewayEventId: string,
): Promise<boolean> {
  const count = await prisma.processedEvent.count({
    where: {
      merchantId,
      gatewayEventId,
    },
  });
  return count > 0;
}

export async function insertProcessedEvent(
  merchantId: string,
  gatewayEventId: string,
  paymentId: string,
  eventReceivedAt: string | Date,
  rawPayload: unknown,
): Promise<ProcessedEventRecord> {
  const payloadString =
    typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload ?? {});

  const row = await prisma.processedEvent.create({
    data: {
      merchantId,
      gatewayEventId,
      paymentId,
      eventReceivedAt:
        typeof eventReceivedAt === 'string' ? new Date(eventReceivedAt) : eventReceivedAt,
      rawPayload: payloadString,
    },
  });
  return toProcessedEventRecord(row);
}

export async function getProcessedEventById(id: string): Promise<ProcessedEventRecord | null> {
  const row = await prisma.processedEvent.findUnique({
    where: { id },
  });
  return row ? toProcessedEventRecord(row) : null;
}
