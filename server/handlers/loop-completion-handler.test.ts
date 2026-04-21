import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { loopCompletionHandler } from './loop-completion-handler'
import type { HandlerCtx, SessionCompletedEvent, LoopScheduler } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'

function makeLoopScheduler(calls: Array<{ loopId: string; state: string }>): LoopScheduler {
  return {
    recordOutcome: async (loopId, state) => {
      calls.push({ loopId, state })
    },
  }
}

function makeCtx(db: Database, loopCalls: Array<{ loopId: string; state: string }>): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: makeLoopScheduler(loopCalls),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
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

describe('loopCompletionHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 50', () => {
    expect(loopCompletionHandler.priority).toBe(50)
  })

  test('calls loopScheduler.recordOutcome when loopId is set', async () => {
    seedSession(db, 'sess-loop', { loopId: 'loop-abc' })
    const calls: Array<{ loopId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-loop', state: 'completed', durationMs: 0 }
    await loopCompletionHandler.handle(ev, ctx)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.loopId).toBe('loop-abc')
    expect(calls[0]!.state).toBe('completed')
  })

  test('does nothing when loopId is not set', async () => {
    seedSession(db, 'sess-no-loop', {})
    const calls: Array<{ loopId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-loop', state: 'completed', durationMs: 0 }
    await loopCompletionHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })

  test('does nothing for unknown session', async () => {
    const calls: Array<{ loopId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'ghost', state: 'completed', durationMs: 0 }
    await loopCompletionHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })
})
