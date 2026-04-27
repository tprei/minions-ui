import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { quotaHandler } from './quota-handler'
import type { HandlerCtx, SessionCompletedEvent } from './types'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
} from './stubs'
import type { SessionRegistry } from '../session/registry'
import type { SessionRuntime } from '../session/runtime'
import type { ApiSession } from '../../shared/api-types'

function makeRegistry(scheduleResumeCalls: Array<{ sessionId: string; resetAt: number }>): SessionRegistry {
  return {
    create: async () => ({ session: {} as ApiSession, runtime: {} as SessionRuntime }),
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => [],
    snapshot: () => undefined,
    stop: async () => undefined,
    close: async () => undefined,
    reply: async () => true,
    reconcileOnBoot: async () => undefined,
    scheduleQuotaResume: async (sessionId, resetAt) => {
      scheduleResumeCalls.push({ sessionId, resetAt })
    },
  }
}

function makeCtx(db: Database, resumeCalls: Array<{ sessionId: string; resetAt: number }>, maxRetries = 3): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: makeRegistry(resumeCalls),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: { quotaRetryMax: maxRetries },
  }
}

function seedSession(db: Database, id: string, retryCount = 0): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', 'task', null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, ?, '{}', 0)`,
    [id, now, now, retryCount],
  )
}

describe('quotaHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 20', () => {
    expect(quotaHandler.priority).toBe(20)
  })

  test('only matches quota_exhausted state', () => {
    const quotaEv: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'quota_exhausted', durationMs: 0 }
    expect(quotaHandler.matches(quotaEv)).toBe(true)

    const completedEv: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'completed', durationMs: 0 }
    expect(quotaHandler.matches(completedEv)).toBe(false)

    const erroredEv: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'errored', durationMs: 0 }
    expect(quotaHandler.matches(erroredEv)).toBe(false)
  })

  test('schedules resume on first quota exhaustion', async () => {
    seedSession(db, 'sess-quota', 0)
    const resumeCalls: Array<{ sessionId: string; resetAt: number }> = []
    const ctx = makeCtx(db, resumeCalls, 3)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-quota', state: 'quota_exhausted', durationMs: 0 }
    const result = await quotaHandler.handle(ev, ctx)

    expect(resumeCalls).toHaveLength(1)
    expect(resumeCalls[0]!.sessionId).toBe('sess-quota')
    expect(resumeCalls[0]!.resetAt).toBeGreaterThan(Date.now())

    const row = db.query<{ quota_retry_count: number }, [string]>('SELECT quota_retry_count FROM sessions WHERE id = ?').get('sess-quota')
    expect(row!.quota_retry_count).toBe(1)
    expect(result.handled).toBe(true)
    expect(result.reason).toBe('quota_resume_scheduled')
  })

  test('does not schedule resume when retry count exceeds max', async () => {
    seedSession(db, 'sess-max', 3)
    const resumeCalls: Array<{ sessionId: string; resetAt: number }> = []
    const ctx = makeCtx(db, resumeCalls, 3)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-max', state: 'quota_exhausted', durationMs: 0 }
    const result = await quotaHandler.handle(ev, ctx)

    expect(resumeCalls).toHaveLength(0)
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('retry_count_exceeded')
  })

  test('increments retry count on each exhaustion up to max', async () => {
    seedSession(db, 'sess-inc', 2)
    const resumeCalls: Array<{ sessionId: string; resetAt: number }> = []
    const ctx = makeCtx(db, resumeCalls, 3)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-inc', state: 'quota_exhausted', durationMs: 0 }
    await quotaHandler.handle(ev, ctx)

    expect(resumeCalls).toHaveLength(1)
    const row = db.query<{ quota_retry_count: number }, [string]>('SELECT quota_retry_count FROM sessions WHERE id = ?').get('sess-inc')
    expect(row!.quota_retry_count).toBe(3)
  })
})
