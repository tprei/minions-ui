import { randomUUID } from 'node:crypto'
import type { CreateExternalTaskRequest, ExternalTask } from '../../shared/api-types'
import { prepared, type ExternalTaskRow } from '../db/sqlite'
import type { Database } from 'bun:sqlite'

export function externalTaskRowToApi(row: ExternalTaskRow): ExternalTask {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    sessionId: row.session_id,
    status: row.status,
    repo: row.repo ?? undefined,
    mode: row.mode,
    title: row.title ?? undefined,
    url: row.url ?? undefined,
    author: row.author ?? undefined,
    metadata: row.metadata,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export function buildExternalTaskMetadata(req: CreateExternalTaskRequest): Record<string, unknown> {
  return {
    entrypoint: {
      source: req.source,
      externalId: req.externalId,
      ...(req.title ? { title: req.title } : {}),
      ...(req.url ? { url: req.url } : {}),
      ...(req.author ? { author: req.author } : {}),
      ...(req.metadata ? { metadata: req.metadata } : {}),
    },
  }
}

export function insertExternalTask(db: Database, req: CreateExternalTaskRequest, sessionId: string, repo: string): ExternalTask {
  const now = Date.now()
  const row: ExternalTaskRow = {
    id: randomUUID(),
    source: req.source,
    external_id: req.externalId,
    session_id: sessionId,
    status: 'started',
    repo,
    mode: req.mode ?? 'task',
    title: req.title ?? null,
    url: req.url ?? null,
    author: req.author ?? null,
    metadata: req.metadata ?? {},
    created_at: now,
    updated_at: now,
  }
  prepared.insertExternalTask(db, row)
  return externalTaskRowToApi(row)
}
