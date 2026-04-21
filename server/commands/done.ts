import type { SessionRegistry } from '../session/registry'
import type { Database } from 'bun:sqlite'
import { prepared } from '../db/sqlite'

export interface DoneCommandCtx {
  registry: SessionRegistry
  db: Database
}

export interface DoneCommandResult {
  ok: boolean
  sessionId?: string
  error?: string
}

export async function handleDoneCommand(
  sessionId: string | undefined,
  ctx: DoneCommandCtx,
): Promise<DoneCommandResult> {
  let resolvedId = sessionId
  if (!resolvedId) {
    const rows = prepared.listSessions(ctx.db)
    const active = rows.find((r) => r.status === 'running' || r.status === 'waiting_input')
    if (!active) return { ok: false, error: 'no active session; provide sessionId' }
    resolvedId = active.id
  }

  const row = prepared.getSession(ctx.db, resolvedId)
  if (!row) return { ok: false, error: `session ${resolvedId} not found` }

  await ctx.registry.stop(resolvedId)
  prepared.updateSession(ctx.db, { id: resolvedId, status: 'completed', updated_at: Date.now() })

  return { ok: true, sessionId: resolvedId }
}
