import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleReplyCommand } from './reply'
import type { SessionRegistry } from '../session/registry'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function seedSession(db: Database, id: string, status: string): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, ?, ?, 'cmd', 'task', ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
    [id, `slug-${id}`, status, now, now],
  )
}

function makeRegistry(): SessionRegistry {
  return {
    async create() { throw new Error('not implemented') },
    get() { return undefined },
    getBySlug() { return undefined },
    list() { return [] },
    snapshot() { return undefined },
    async stop() {},
    async close() {},
    async reply() { return true },
    async reconcileOnBoot() {},
    async scheduleQuotaResume() {},
  }
}

describe('handleReplyCommand', () => {
  test('empty text returns error', async () => {
    const db = makeDb()
    const result = await handleReplyCommand('', 's1', { registry: makeRegistry(), db })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('text required')
    db.close()
  })

  test('with sessionId sends reply', async () => {
    const db = makeDb()
    const result = await handleReplyCommand('hello', 's1', { registry: makeRegistry(), db })
    expect(result.ok).toBe(true)
    expect(result.sessionId).toBe('s1')
    db.close()
  })

  test('without sessionId uses active session', async () => {
    const db = makeDb()
    seedSession(db, 'active-1', 'running')
    const result = await handleReplyCommand('hello', undefined, { registry: makeRegistry(), db })
    expect(result.ok).toBe(true)
    expect(result.sessionId).toBe('active-1')
    db.close()
  })

  test('without sessionId and no active session returns error', async () => {
    const db = makeDb()
    const result = await handleReplyCommand('hello', undefined, { registry: makeRegistry(), db })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no active session')
    db.close()
  })
})
