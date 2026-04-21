import type { Database } from 'bun:sqlite'

export interface StatRow {
  mode: string
  state: string
  count: number
  total_tokens: number | null
}

export interface StatsCommandResult {
  ok: boolean
  periodStart?: number
  periodEnd?: number
  totalSessions?: number
  totalTokens?: number
  byState?: Record<string, number>
  byMode?: Record<string, number>
  error?: string
}

export function handleStatsCommand(days: number, db: Database): StatsCommandResult {
  const now = Date.now()
  const periodStart = now - days * 24 * 60 * 60 * 1000

  const rows = db
    .query<StatRow, [number]>(
      `SELECT mode, state, COUNT(*) as count, SUM(total_tokens) as total_tokens
       FROM session_stats
       WHERE recorded_at >= ?
       GROUP BY mode, state
       LIMIT 500`,
    )
    .all(periodStart)

  let totalSessions = 0
  let totalTokens = 0
  const byState: Record<string, number> = {}
  const byMode: Record<string, number> = {}

  for (const row of rows) {
    totalSessions += row.count
    totalTokens += row.total_tokens ?? 0
    byState[row.state] = (byState[row.state] ?? 0) + row.count
    byMode[row.mode] = (byMode[row.mode] ?? 0) + row.count
  }

  return {
    ok: true,
    periodStart,
    periodEnd: now,
    totalSessions,
    totalTokens,
    byState,
    byMode,
  }
}
