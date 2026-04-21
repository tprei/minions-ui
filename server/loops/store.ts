import type { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type { LoopDefinition } from './definitions'

export interface LoopRow {
  id: string
  enabled: boolean
  interval_ms: number
  last_run_at: number | null
  consecutive_failures: number
  last_pr_url: string | null
  created_at: number
  updated_at: number
}

interface LoopDbRow {
  id: string
  enabled: number
  interval_ms: number
  last_run_at: number | null
  consecutive_failures: number
  last_pr_url: string | null
  created_at: number
  updated_at: number
}

function mapRow(row: LoopDbRow): LoopRow {
  return {
    ...row,
    enabled: row.enabled !== 0,
  }
}

export function upsertLoop(db: Database, def: LoopDefinition): void {
  const now = Date.now()
  db.run(
    `INSERT INTO loops (id, enabled, interval_ms, last_run_at, consecutive_failures, last_pr_url, created_at, updated_at)
     VALUES (?, 1, ?, NULL, 0, NULL, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [def.id, def.intervalMs, now, now],
  )
}

export function getLoop(db: Database, id: string): LoopRow | null {
  const row = db
    .query<LoopDbRow, [string]>('SELECT * FROM loops WHERE id = ?')
    .get(id)
  return row ? mapRow(row) : null
}

export function listLoops(db: Database): LoopRow[] {
  const rows = db.query<LoopDbRow, []>('SELECT * FROM loops ORDER BY id').all()
  return rows.map(mapRow)
}

export function setLoopEnabled(db: Database, id: string, enabled: boolean): void {
  const now = Date.now()
  db.run('UPDATE loops SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, now, id])
}

export function setLoopInterval(db: Database, id: string, intervalMs: number): void {
  const now = Date.now()
  db.run('UPDATE loops SET interval_ms = ?, updated_at = ? WHERE id = ?', [intervalMs, now, id])
}

export function recordLoopRun(
  db: Database,
  id: string,
  consecutiveFailures: number,
  lastPrUrl: string | null,
): void {
  const now = Date.now()
  db.run(
    'UPDATE loops SET last_run_at = ?, consecutive_failures = ?, last_pr_url = COALESCE(?, last_pr_url), updated_at = ? WHERE id = ?',
    [now, consecutiveFailures, lastPrUrl, now, id],
  )
}

export function dumpLoopsJson(db: Database, workspaceRoot: string): void {
  const rows = listLoops(db)
  const outPath = path.join(workspaceRoot, '.loops.json')
  const tmp = `${outPath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8')
  fs.renameSync(tmp, outPath)
}
