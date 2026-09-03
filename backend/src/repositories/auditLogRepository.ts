// Audit log repository — append-only DB access layer stub.
// All functions throw "not implemented" — no fake/simulated DB calls.

export interface AuditLogRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  details: unknown;
  createdAt: string;
}

export interface AuditLogInsert {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  details: unknown;
}

export function insertAuditLog(_insert: AuditLogInsert): Promise<AuditLogRecord> {
  throw new Error('not implemented');
}

export function getAuditLogsForEntity(
  _entityType: string,
  _entityId: string,
): Promise<AuditLogRecord[]> {
  throw new Error('not implemented');
}
