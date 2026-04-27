import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations, prepared } from '../db/sqlite'
import { handleSubmitFeedback, type SubmitFeedbackInput } from './feedback'
import type { SessionRegistry } from '../session/registry'
import type { ApiSession } from '../../shared/api-types'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function seedSession(db: Database, id: string, repo: string | null): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, ?, 'completed', 'test task', 'task', ?, ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
    [id, `slug-${id}`, repo, now, now],
  )
}

function seedEvents(db: Database, sessionId: string): void {
  db.run(
    `INSERT INTO session_events (session_id, seq, turn, type, timestamp, payload)
     VALUES (?, 1, 1, 'user_message', ?, ?)`,
    [sessionId, Date.now(), JSON.stringify({ text: 'Please help me with X' })],
  )
  db.run(
    `INSERT INTO session_events (session_id, seq, turn, type, timestamp, payload)
     VALUES (?, 2, 1, 'assistant_text', ?, ?)`,
    [sessionId, Date.now(), JSON.stringify({ blockId: 'block-1', text: 'Here is my answer', final: true })],
  )
}

function makeRegistry(onCreateCalled?: (opts: { mode: string; prompt: string; repo: string; parentId?: string; metadata?: Record<string, unknown> }) => void): SessionRegistry {
  return {
    async create(opts) {
      onCreateCalled?.(opts)
      return {
        session: { id: 'child-session-id' } as ApiSession,
        runtime: {} as never,
      }
    },
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

describe('handleSubmitFeedback', () => {
  test('missing sourceSessionId returns error', async () => {
    const db = makeDb()
    const input: SubmitFeedbackInput = {
      sourceSessionId: '',
      sourceSessionSlug: 'test-slug',
      sourceMessageBlockId: 'block-1',
      vote: 'up',
    }
    const result = await handleSubmitFeedback(input, { registry: makeRegistry(), db })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sourceSessionId required')
    db.close()
  })

  test('missing vote returns error', async () => {
    const db = makeDb()
    const input: SubmitFeedbackInput = {
      sourceSessionId: 's1',
      sourceSessionSlug: 'test-slug',
      sourceMessageBlockId: 'block-1',
      vote: '' as never,
    }
    const result = await handleSubmitFeedback(input, { registry: makeRegistry(), db })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('vote required')
    db.close()
  })

  test('session not found returns error', async () => {
    const db = makeDb()
    const input: SubmitFeedbackInput = {
      sourceSessionId: 'nonexistent',
      sourceSessionSlug: 'test-slug',
      sourceMessageBlockId: 'block-1',
      vote: 'up',
    }
    const result = await handleSubmitFeedback(input, { registry: makeRegistry(), db })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
    db.close()
  })

  test('upvote with repo spawns feedback minion', async () => {
    const db = makeDb()
    seedSession(db, 's1', 'https://github.com/owner/repo')
    seedEvents(db, 's1')

    let createCalled = false
    let capturedOpts: { mode: string; prompt: string; repo: string; parentId?: string; metadata?: Record<string, unknown> } | undefined

    const result = await handleSubmitFeedback(
      {
        sourceSessionId: 's1',
        sourceSessionSlug: 'slug-s1',
        sourceMessageBlockId: 'block-1',
        vote: 'up',
      },
      {
        registry: makeRegistry((opts) => {
          createCalled = true
          capturedOpts = opts
        }),
        db,
      },
    )

    expect(result.ok).toBe(true)
    expect(result.childSessionId).toBe('child-session-id')
    expect(createCalled).toBe(true)
    expect(capturedOpts?.mode).toBe('task')
    expect(capturedOpts?.repo).toBe('https://github.com/owner/repo')
    expect(capturedOpts?.parentId).toBe('s1')
    expect(capturedOpts?.metadata?.kind).toBe('feedback')
    expect(capturedOpts?.metadata?.vote).toBe('up')
    expect(capturedOpts?.prompt).toContain('Positive feedback')
    expect(capturedOpts?.prompt).toContain('Identify what worked well')

    const auditRows = db.query('SELECT * FROM audit_events WHERE action = ?').all('message_feedback')
    expect(auditRows.length).toBe(1)

    db.close()
  })

  test('downvote with reason and comment spawns feedback minion', async () => {
    const db = makeDb()
    seedSession(db, 's2', 'https://github.com/owner/repo')
    seedEvents(db, 's2')

    let capturedOpts: { mode: string; prompt: string; repo: string; parentId?: string; metadata?: Record<string, unknown> } | undefined

    const result = await handleSubmitFeedback(
      {
        sourceSessionId: 's2',
        sourceSessionSlug: 'slug-s2',
        sourceMessageBlockId: 'block-1',
        vote: 'down',
        reason: 'incorrect',
        comment: 'This approach was wrong',
      },
      {
        registry: makeRegistry((opts) => {
          capturedOpts = opts
        }),
        db,
      },
    )

    expect(result.ok).toBe(true)
    expect(result.childSessionId).toBe('child-session-id')
    expect(capturedOpts?.metadata?.vote).toBe('down')
    expect(capturedOpts?.metadata?.reason).toBe('incorrect')
    expect(capturedOpts?.metadata?.comment).toBe('This approach was wrong')
    expect(capturedOpts?.prompt).toContain('Negative feedback')
    expect(capturedOpts?.prompt).toContain('Reason:** Incorrect')
    expect(capturedOpts?.prompt).toContain('This approach was wrong')
    expect(capturedOpts?.prompt).toContain('Diagnose what went wrong')

    db.close()
  })

  test('feedback without repo records audit but does not spawn', async () => {
    const db = makeDb()
    seedSession(db, 's3', null)
    seedEvents(db, 's3')

    let createCalled = false

    const result = await handleSubmitFeedback(
      {
        sourceSessionId: 's3',
        sourceSessionSlug: 'slug-s3',
        sourceMessageBlockId: 'block-1',
        vote: 'up',
      },
      {
        registry: makeRegistry(() => {
          createCalled = true
        }),
        db,
      },
    )

    expect(result.ok).toBe(true)
    expect(result.childSessionId).toBeUndefined()
    expect(createCalled).toBe(false)

    const auditRows = db.query('SELECT * FROM audit_events WHERE action = ?').all('message_feedback')
    expect(auditRows.length).toBe(1)

    db.close()
  })

  test('audit event is always recorded', async () => {
    const db = makeDb()
    seedSession(db, 's4', 'https://github.com/owner/repo')
    seedEvents(db, 's4')

    await handleSubmitFeedback(
      {
        sourceSessionId: 's4',
        sourceSessionSlug: 'slug-s4',
        sourceMessageBlockId: 'block-1',
        vote: 'down',
        reason: 'too_verbose',
        comment: 'Too long',
      },
      { registry: makeRegistry(), db },
    )

    const auditRow = prepared.listAuditEvents(db).find(r => r.action === 'message_feedback')
    expect(auditRow).toBeDefined()
    expect(auditRow?.session_id).toBe('s4')
    expect(auditRow?.metadata.vote).toBe('down')
    expect(auditRow?.metadata.reason).toBe('too_verbose')
    expect(auditRow?.metadata.comment).toBe('Too long')

    db.close()
  })
})
