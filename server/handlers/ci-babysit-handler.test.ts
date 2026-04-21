import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { ciBabysitHandler } from './ci-babysit-handler'
import type { HandlerCtx, SessionCompletedEvent, CIBabysitter } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'

type BabysitCall = { sessionId: string; prUrl: string }
type DeferredCall = { sessionId: string; parentThreadId: string }

function makeCIBabysitter(babysitCalls: BabysitCall[], deferredCalls: DeferredCall[]): CIBabysitter {
  return {
    babysitPR: async (sessionId, prUrl) => { babysitCalls.push({ sessionId, prUrl }) },
    queueDeferredBabysit: async (sessionId, parentThreadId) => { deferredCalls.push({ sessionId, parentThreadId }) },
    babysitDagChildCI: async () => {},
  }
}

function makeCtx(db: Database, babysitter: CIBabysitter): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: babysitter,
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, prUrl: string | null, metadata: Record<string, unknown> = {}): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'my-slug', 'completed', 'cmd', 'task', null, null, null, ?, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, ?, 0)`,
    [id, prUrl, now, now, JSON.stringify(metadata)],
  )
}

describe('ciBabysitHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 0', () => {
    expect(ciBabysitHandler.priority).toBe(0)
  })

  test('calls babysitPR when session has a pr_url and no parentThreadId', async () => {
    seedSession(db, 'sess-ci', 'https://github.com/org/repo/pull/5')
    const babysitCalls: BabysitCall[] = []
    const deferredCalls: DeferredCall[] = []
    const ctx = makeCtx(db, makeCIBabysitter(babysitCalls, deferredCalls))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-ci', state: 'completed', durationMs: 0 }
    await ciBabysitHandler.handle(ev, ctx)

    expect(babysitCalls).toHaveLength(1)
    expect(babysitCalls[0]!.prUrl).toBe('https://github.com/org/repo/pull/5')
    expect(deferredCalls).toHaveLength(0)
  })

  test('calls queueDeferredBabysit when parentThreadId is set', async () => {
    seedSession(db, 'sess-deferred', 'https://github.com/org/repo/pull/6', { parentThreadId: 'thread-42' })
    const babysitCalls: BabysitCall[] = []
    const deferredCalls: DeferredCall[] = []
    const ctx = makeCtx(db, makeCIBabysitter(babysitCalls, deferredCalls))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-deferred', state: 'completed', durationMs: 0 }
    await ciBabysitHandler.handle(ev, ctx)

    expect(deferredCalls).toHaveLength(1)
    expect(deferredCalls[0]!.parentThreadId).toBe('thread-42')
    expect(babysitCalls).toHaveLength(0)
  })

  test('does nothing when pr_url is null', async () => {
    seedSession(db, 'sess-no-pr', null)
    const babysitCalls: BabysitCall[] = []
    const deferredCalls: DeferredCall[] = []
    const ctx = makeCtx(db, makeCIBabysitter(babysitCalls, deferredCalls))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-pr', state: 'completed', durationMs: 0 }
    await ciBabysitHandler.handle(ev, ctx)

    expect(babysitCalls).toHaveLength(0)
    expect(deferredCalls).toHaveLength(0)
  })
})
