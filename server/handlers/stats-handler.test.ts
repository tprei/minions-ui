import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { statsHandler } from './stats-handler'
import type { HandlerCtx, SessionCompletedEvent } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'

function makeCtx(db: Database): HandlerCtx {
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
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, slug: string, mode: string, repo: string | null = null): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, ?, 'completed', 'cmd', ?, ?, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    [id, slug, mode, repo, now, now],
  )
}

describe('statsHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 10', () => {
    expect(statsHandler.priority).toBe(10)
  })

  test('matches all events', () => {
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'completed', durationMs: 0 }
    expect(statsHandler.matches(ev)).toBe(true)
    const ev2: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'errored', durationMs: 0 }
    expect(statsHandler.matches(ev2)).toBe(true)
  })

  test('inserts a row into session_stats', async () => {
    seedSession(db, 'sess-1', 'cool-river-0001', 'task', 'https://github.com/org/repo')
    const ctx = makeCtx(db)

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'sess-1',
      state: 'completed',
      durationMs: 4200,
      totalTokens: 1337,
    }

    await statsHandler.handle(ev, ctx)

    const row = db
      .query<{ session_id: string; slug: string; mode: string; state: string; duration_ms: number; total_tokens: number | null }, []>(
        'SELECT session_id, slug, mode, state, duration_ms, total_tokens FROM session_stats LIMIT 1',
      )
      .get()

    expect(row).not.toBeNull()
    expect(row!.session_id).toBe('sess-1')
    expect(row!.slug).toBe('cool-river-0001')
    expect(row!.mode).toBe('task')
    expect(row!.state).toBe('completed')
    expect(row!.duration_ms).toBe(4200)
    expect(row!.total_tokens).toBe(1337)
  })

  test('handles missing session gracefully (no row inserted)', async () => {
    const ctx = makeCtx(db)
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'ghost', state: 'completed', durationMs: 0 }
    await statsHandler.handle(ev, ctx)

    const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM session_stats').get()
    expect(count!.c).toBe(0)
  })

  test('records null totalTokens when event has none', async () => {
    seedSession(db, 'sess-2', 'slow-oak-0002', 'task')
    const ctx = makeCtx(db)
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-2', state: 'errored', durationMs: 100 }
    await statsHandler.handle(ev, ctx)

    const row = db
      .query<{ total_tokens: number | null }, [string]>('SELECT total_tokens FROM session_stats WHERE session_id = ?')
      .get('sess-2')
    expect(row!.total_tokens).toBeNull()
  })
})
