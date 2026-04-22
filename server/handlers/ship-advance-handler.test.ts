import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { shipAdvanceHandler } from './ship-advance-handler'
import type { HandlerCtx, SessionCompletedEvent, DagScheduler } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'

function makeScheduler(calls: string[]): DagScheduler {
  return {
    onSessionCompleted: async (sessionId: string) => {
      calls.push(sessionId)
    },
  }
}

function makeCtx(db: Database, schedulerCalls: string[]): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: makeScheduler(schedulerCalls),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, mode: string, pipelineAdvancing = false): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', ?, null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', ?)`,
    [id, mode, now, now, pipelineAdvancing ? 1 : 0],
  )
}

describe('shipAdvanceHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 30', () => {
    expect(shipAdvanceHandler.priority).toBe(30)
  })

  test('matches only completed state', () => {
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'completed', durationMs: 0 }
    expect(shipAdvanceHandler.matches(ev)).toBe(true)

    const errEv: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'errored', durationMs: 0 }
    expect(shipAdvanceHandler.matches(errEv)).toBe(false)
  })

  test('calls scheduler for ship mode sessions', async () => {
    seedSession(db, 'sess-ship', 'ship-think')
    const calls: string[] = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-ship', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(calls).toContain('sess-ship')
  })

  test('skips non-ship mode sessions', async () => {
    seedSession(db, 'sess-task', 'task')
    const calls: string[] = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-task', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })

  test('skips when pipeline_advancing is already set', async () => {
    seedSession(db, 'sess-advancing', 'ship-think', true)
    const calls: string[] = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-advancing', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })

  test('clears pipeline_advancing flag after scheduler call', async () => {
    seedSession(db, 'sess-flag', 'ship-think')
    const calls: string[] = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-flag', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    const row = db.query<{ pipeline_advancing: number }, [string]>('SELECT pipeline_advancing FROM sessions WHERE id = ?').get('sess-flag')
    expect(row!.pipeline_advancing).toBe(0)
  })

  test('clears pipeline_advancing even when scheduler throws', async () => {
    seedSession(db, 'sess-err', 'ship-think')
    const calls: string[] = []
    const bus = new EngineEventBus()
    const ctx: HandlerCtx = {
      db,
      registry: createSessionRegistry({ getDb: () => db }),
      bus,
      scheduler: {
        onSessionCompleted: async () => { throw new Error('scheduler error') },
      },
      loopScheduler: createNoopLoopScheduler(),
      ciBabysitter: createNoopCIBabysitter(),
      qualityGates: createNoopQualityGates(),
      digest: createNoopDigestBuilder(),
      profileStore: createNoopProfileStore(),
      replyQueue: createNoopReplyQueueFactory(),
      config: createDefaultConfig(),
    }

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-err', state: 'completed', durationMs: 0 }
    await expect(shipAdvanceHandler.handle(ev, ctx)).rejects.toThrow('scheduler error')

    const row = db.query<{ pipeline_advancing: number }, [string]>('SELECT pipeline_advancing FROM sessions WHERE id = ?').get('sess-err')
    expect(row!.pipeline_advancing).toBe(0)
    void calls
  })
})
