import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleCleanCommand } from './clean'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

describe('handleCleanCommand', () => {
  test('empty db → ok with zero counts', () => {
    const db = makeDb()
    const result = handleCleanCommand(db)
    expect(result.ok).toBe(true)
    expect(result.removedSessions).toBe(0)
    expect(result.removedOrphans).toBe(0)
    expect(result.freedBytes).toBe(0)
    db.close()
  })

  test('recent completed sessions are not removed', () => {
    const db = makeDb()
    const now = Date.now()
    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('s1', 'recent-slug', 'completed', 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
      [now - 1000, now - 1000],
    )
    const result = handleCleanCommand(db)
    expect(result.removedSessions).toBe(0)
    const row = db.query<{ id: string }, []>('SELECT id FROM sessions').get()
    expect(row?.id).toBe('s1')
    db.close()
  })

  test('old failed sessions are removed', () => {
    const db = makeDb()
    const OLD = Date.now() - 8 * 24 * 60 * 60 * 1000
    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('s-old', 'old-slug', 'failed', 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
      [OLD, OLD],
    )
    const result = handleCleanCommand(db)
    expect(result.removedSessions).toBe(1)
    const row = db.query<{ id: string }, []>('SELECT id FROM sessions').get()
    expect(row).toBeNull()
    db.close()
  })

  test('running sessions are not cleaned up', () => {
    const db = makeDb()
    const OLD = Date.now() - 8 * 24 * 60 * 60 * 1000
    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('s-run', 'run-slug', 'running', 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
      [OLD, OLD],
    )
    const result = handleCleanCommand(db)
    expect(result.removedSessions).toBe(0)
    db.close()
  })
})
