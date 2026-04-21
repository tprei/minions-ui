import type { SessionRegistry } from '../session/registry'
import type { Database } from 'bun:sqlite'
import { prepared } from '../db/sqlite'

export interface ReplyCommandCtx {
  registry: SessionRegistry
  db: Database
}

export interface ReplyCommandResult {
  ok: boolean
  sessionId?: string
  error?: string
}

export async function handleReplyCommand(
  text: string,
  sessionId: string | undefined,
  ctx: ReplyCommandCtx,
): Promise<ReplyCommandResult> {
  if (!text.trim()) return { ok: false, error: 'text required' }

  let resolvedId = sessionId
  if (!resolvedId) {
    const rows = prepared.listSessions(ctx.db)
    const active = rows.find((r) => r.status === 'running' || r.status === 'waiting_input')
    if (!active) return { ok: false, error: 'no active session; provide sessionId' }
    resolvedId = active.id
  }

  try {
    await ctx.registry.reply(resolvedId, text)
    return { ok: true, sessionId: resolvedId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
