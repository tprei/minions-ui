import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { pendingFeedbackHandler } from './pending-feedback-handler'
import type { HandlerCtx, SessionCompletedEvent, ReplyQueue, ReplyQueueFactory } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createDefaultConfig,
} from './stubs'

function makeReplyQueueFactory(pendingMessages: string[]): ReplyQueueFactory {
  return {
    forSession: (): ReplyQueue => ({
      pending: async () => [...pendingMessages],
      drain: async () => {
        const msgs = [...pendingMessages]
        pendingMessages.splice(0)
        return msgs
      },
    }),
  }
}

function makeCtx(db: Database, replyQueue: ReplyQueueFactory): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue,
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, metadata: Record<string, unknown> = {}): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', 'task', null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, ?, 0)`,
    [id, now, now, JSON.stringify(metadata)],
  )
}

describe('pendingFeedbackHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 0', () => {
    expect(pendingFeedbackHandler.priority).toBe(0)
  })

  test('drains pending reply queue messages into metadata.pendingFeedback', async () => {
    seedSession(db, 'sess-pf', {})
    const pending = ['feedback message 1', 'feedback message 2']
    const ctx = makeCtx(db, makeReplyQueueFactory(pending))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-pf', state: 'completed', durationMs: 0 }
    await pendingFeedbackHandler.handle(ev, ctx)

    const row = db.query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?').get('sess-pf')
    const meta = JSON.parse(row!.metadata) as { pendingFeedback?: string[] }
    expect(meta.pendingFeedback).toEqual(['feedback message 1', 'feedback message 2'])
  })

  test('merges with existing pendingFeedback in metadata', async () => {
    seedSession(db, 'sess-merge', { pendingFeedback: ['existing msg'] })
    const pending = ['new msg']
    const ctx = makeCtx(db, makeReplyQueueFactory(pending))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-merge', state: 'completed', durationMs: 0 }
    await pendingFeedbackHandler.handle(ev, ctx)

    const row = db.query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?').get('sess-merge')
    const meta = JSON.parse(row!.metadata) as { pendingFeedback?: string[] }
    expect(meta.pendingFeedback).toEqual(['existing msg', 'new msg'])
  })

  test('does nothing when queue is empty', async () => {
    seedSession(db, 'sess-empty', {})
    const ctx = makeCtx(db, makeReplyQueueFactory([]))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-empty', state: 'completed', durationMs: 0 }
    await pendingFeedbackHandler.handle(ev, ctx)

    const row = db.query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?').get('sess-empty')
    const meta = JSON.parse(row!.metadata) as { pendingFeedback?: string[] }
    expect(meta.pendingFeedback).toBeUndefined()
  })

  test('does nothing for unknown session', async () => {
    const ctx = makeCtx(db, makeReplyQueueFactory(['msg']))
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'ghost', state: 'completed', durationMs: 0 }
    await pendingFeedbackHandler.handle(ev, ctx)
  })
})
