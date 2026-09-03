// Processed event repository — DB access layer stub for idempotency.
// All functions throw "not implemented" — no fake/simulated DB calls.

export interface ProcessedEventRecord {
  id: string;
  merchantId: string;
  gatewayEventId: string;
  paymentId: string;
  eventReceivedAt: string;
  rawPayload: unknown;
  createdAt: string;
}

export function isEventProcessed(
  _merchantId: string,
  _gatewayEventId: string,
): Promise<boolean> {
  throw new Error('not implemented');
}

export function insertProcessedEvent(
  _merchantId: string,
  _gatewayEventId: string,
  _paymentId: string,
  _eventReceivedAt: string,
  _rawPayload: unknown,
): Promise<ProcessedEventRecord> {
  throw new Error('not implemented');
}

export function getProcessedEventById(_id: string): Promise<ProcessedEventRecord | null> {
  throw new Error('not implemented');
}
