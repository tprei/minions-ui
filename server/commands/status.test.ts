import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleStatusCommand } from './status'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

describe('handleStatusCommand', () => {
  test('empty db → ok with 0 sessions', () => {
    const db = makeDb()
    const result = handleStatusCommand(undefined, db)
    expect(result.ok).toBe(true)
    expect(result.sessions).toEqual([])
    expect(result.summary).toContain('0 sessions')
    db.close()
  })

  test('with sessions → summary and list', () => {
    const db = makeDb()
    const now = Date.now()
    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('s1', 'sluggo', 'running', 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
      [now, now],
    )
    const result = handleStatusCommand(undefined, db)
    expect(result.ok).toBe(true)
    expect(result.sessions?.length).toBe(1)
    expect(result.summary).toContain('1 sessions')
    db.close()
  })

  test('with specific sessionId → single session', () => {
    const db = makeDb()
    const now = Date.now()
    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('s1', 'my-slug', 'running', 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
      [now, now],
    )
    const result = handleStatusCommand('s1', db)
    expect(result.ok).toBe(true)
    expect(result.sessions?.length).toBe(1)
    expect(result.sessions?.[0]?.id).toBe('s1')
    db.close()
  })

  test('unknown sessionId → error', () => {
    const db = makeDb()
    const result = handleStatusCommand('no-such-id', db)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    db.close()
  })
})
