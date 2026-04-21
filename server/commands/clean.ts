import type { Database } from 'bun:sqlite'
import path from 'node:path'
import fs from 'node:fs'

const STALE_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface CleanResult {
  ok: boolean
  freedBytes: number
  removedSessions: number
  removedOrphans: number
  error?: string
}

interface StaleSessionRow {
  id: string
  slug: string
  workspace_root: string | null
  updated_at: number
}

export function handleCleanCommand(db: Database): CleanResult {
  const cutoff = Date.now() - STALE_SESSION_AGE_MS

  const stale = db
    .query<StaleSessionRow, [number]>(
      `SELECT id, slug, workspace_root, updated_at
       FROM sessions
       WHERE status IN ('completed','failed') AND updated_at < ?`,
    )
    .all(cutoff)

  let freedBytes = 0
  let removedSessions = 0
  let removedOrphans = 0

  for (const row of stale) {
    if (row.workspace_root) {
      const sessionDir = path.join(row.workspace_root, row.slug)
      freedBytes += measureDir(sessionDir)
      removeDir(sessionDir)
    }
    db.run('DELETE FROM sessions WHERE id = ?', [row.id])
    removedSessions++
  }

  if (stale.length > 0) {
    const rows = db
      .query<{ id: string }, []>('SELECT id FROM dag_nodes WHERE session_id NOT IN (SELECT id FROM sessions)')
      .all()
    removedOrphans = rows.length
    if (rows.length > 0) {
      db.run('DELETE FROM dag_nodes WHERE session_id NOT IN (SELECT id FROM sessions)')
    }
  }

  return { ok: true, freedBytes, removedSessions, removedOrphans }
}

function measureDir(dir: string): number {
  let total = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const full = path.join(dir, entry)
      try {
        const stat = fs.statSync(full)
        total += stat.size
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return total
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
