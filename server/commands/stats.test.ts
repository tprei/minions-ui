import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleStatsCommand } from './stats'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function seedStats(db: Database): void {
  const now = Date.now()
  db.run(
    `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s1', 'slug-1', null, 'task', 'completed', 60000, 1500, now - 500],
  )
  db.run(
    `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s2', 'slug-2', null, 'plan', 'failed', 30000, 500, now - 1000],
  )
}

describe('handleStatsCommand', () => {
  test('empty db returns zero counts', () => {
    const db = makeDb()
    const result = handleStatsCommand(30, db)
    expect(result.ok).toBe(true)
    expect(result.totalSessions).toBe(0)
    expect(result.totalTokens).toBe(0)
    db.close()
  })

  test('returns aggregated totals', () => {
    const db = makeDb()
    seedStats(db)
    const result = handleStatsCommand(30, db)
    expect(result.ok).toBe(true)
    expect(result.totalSessions).toBe(2)
    expect(result.totalTokens).toBe(2000)
    db.close()
  })

  test('byState contains correct state counts', () => {
    const db = makeDb()
    seedStats(db)
    const result = handleStatsCommand(30, db)
    expect(result.byState?.['completed']).toBe(1)
    expect(result.byState?.['failed']).toBe(1)
    db.close()
  })

  test('byMode contains correct mode counts', () => {
    const db = makeDb()
    seedStats(db)
    const result = handleStatsCommand(30, db)
    expect(result.byMode?.['task']).toBe(1)
    expect(result.byMode?.['plan']).toBe(1)
    db.close()
  })

  test('periodStart is in the past', () => {
    const db = makeDb()
    const before = Date.now()
    const result = handleStatsCommand(30, db)
    expect(result.periodStart).toBeLessThan(before)
    db.close()
  })

  test('days=1 excludes old records', () => {
    const db = makeDb()
    const OLD = Date.now() - 2 * 24 * 60 * 60 * 1000
    db.run(
      `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s-old', 'old-slug', null, 'task', 'completed', 10000, 100, OLD],
    )
    const result = handleStatsCommand(1, db)
    expect(result.totalSessions).toBe(0)
    db.close()
  })
})
