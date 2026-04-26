import type { Database } from 'bun:sqlite'
import type { QualityReport, ReadinessSummary, ReadinessSummaryBucket } from '../../shared/api-types'
import { prepared, type SessionRow } from '../db/sqlite'

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function buckets(map: Map<string, number>): ReadinessSummaryBucket[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function qualityReport(row: SessionRow): QualityReport | null {
  const report = row.metadata.qualityReport
  if (!report || typeof report !== 'object') return null
  const candidate = report as Partial<QualityReport>
  if (typeof candidate.allPassed !== 'boolean' || !Array.isArray(candidate.results)) return null
  return candidate as QualityReport
}

export function buildReadinessSummary(db: Database): ReadinessSummary {
  const sessions = prepared.listSessions(db)
  const byStatus = new Map<string, number>()
  const byMode = new Map<string, number>()
  const byRepo = new Map<string, number>()
  let withPr = 0
  let withReport = 0
  let passed = 0
  let failed = 0

  for (const row of sessions) {
    increment(byStatus, row.status)
    increment(byMode, row.mode)
    increment(byRepo, row.repo ?? '(none)')
    if (row.pr_url) withPr++

    const report = qualityReport(row)
    if (!report) continue
    withReport++
    if (report.allPassed) {
      passed++
    } else {
      failed++
    }
  }

  const checkpointRows = db
    .query<{ total: number; sessions_with_checkpoints: number }, []>(
      'SELECT COUNT(*) as total, COUNT(DISTINCT session_id) as sessions_with_checkpoints FROM session_checkpoints',
    )
    .get()

  return {
    generatedAt: new Date().toISOString(),
    sessions: {
      total: sessions.length,
      byStatus: buckets(byStatus),
      byMode: buckets(byMode),
      byRepo: buckets(byRepo),
    },
    pullRequests: {
      withPr,
      withoutPr: sessions.length - withPr,
    },
    quality: {
      withReport,
      passed,
      failed,
      missing: sessions.length - withReport,
    },
    checkpoints: {
      total: checkpointRows?.total ?? 0,
      sessionsWithCheckpoints: checkpointRows?.sessions_with_checkpoints ?? 0,
    },
  }
}
