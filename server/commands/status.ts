import type { Database } from 'bun:sqlite'
import { prepared } from '../db/sqlite'

export interface StatusCommandResult {
  ok: boolean
  summary?: string
  sessions?: Array<{ id: string; slug: string; status: string; mode: string; repo: string | null }>
  error?: string
}

export function handleStatusCommand(sessionId: string | undefined, db: Database): StatusCommandResult {
  if (sessionId) {
    const row = prepared.getSession(db, sessionId)
    if (!row) return { ok: false, error: `Session ${sessionId} not found` }
    return {
      ok: true,
      summary: `Session ${row.slug} — status: ${row.status}, mode: ${row.mode}`,
      sessions: [{ id: row.id, slug: row.slug, status: row.status, mode: row.mode, repo: row.repo }],
    }
  }

  const rows = prepared.listSessions(db)
  const counts: Record<string, number> = {}
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1
  }

  const parts = Object.entries(counts).map(([s, n]) => `${s}:${n}`)
  return {
    ok: true,
    summary: `${rows.length} sessions — ${parts.join(', ')}`,
    sessions: rows.map((r) => ({ id: r.id, slug: r.slug, status: r.status, mode: r.mode, repo: r.repo })),
  }
}
