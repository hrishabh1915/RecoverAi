// Audit log repository — append-only DB access layer.
// Provides complete auditable trail for every event, AI diagnosis, decision, and recovery attempt.

import { prisma } from '../lib/prisma.js';

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

function toAuditLogRecord(row: {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  details: string;
  createdAt: Date;
}): AuditLogRecord {
  let parsedDetails: unknown = row.details;
  try {
    parsedDetails = JSON.parse(row.details);
  } catch {
    // Keep as string if not JSON
  }

  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    actor: row.actor,
    details: parsedDetails,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertAuditLog(insert: AuditLogInsert): Promise<AuditLogRecord> {
  const detailsString =
    typeof insert.details === 'string' ? insert.details : JSON.stringify(insert.details ?? {});

  const row = await prisma.auditLog.create({
    data: {
      entityType: insert.entityType,
      entityId: insert.entityId,
      action: insert.action,
      actor: insert.actor,
      details: detailsString,
    },
  });

  return toAuditLogRecord(row);
}

export async function getAuditLogsForEntity(
  entityType: string,
  entityId: string,
): Promise<AuditLogRecord[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toAuditLogRecord);
}

export async function getAllAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
  const rows = await prisma.auditLog.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toAuditLogRecord);
}
