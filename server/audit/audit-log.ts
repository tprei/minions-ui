import { randomUUID } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { AuditEvent } from '../../shared/api-types'
import { prepared, type AuditEventRow } from '../db/sqlite'

export function auditEventRowToApi(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    sessionId: row.session_id ?? undefined,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    metadata: row.metadata,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export function recordAuditEvent(db: Database, opts: {
  action: string
  sessionId?: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}): AuditEvent {
  const row: AuditEventRow = {
    id: randomUUID(),
    action: opts.action,
    session_id: opts.sessionId ?? null,
    target_type: opts.targetType ?? null,
    target_id: opts.targetId ?? null,
    metadata: opts.metadata ?? {},
    created_at: Date.now(),
  }
  prepared.insertAuditEvent(db, row)
  return auditEventRowToApi(row)
}
