import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { modeCompletionHandler } from './mode-completion-handler'
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
import type { EngineEvent } from '../events/types'

function makeCtx(db: Database, bus: EngineEventBus): HandlerCtx {
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

function seedSession(db: Database, id: string, mode: string): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', ?, null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    [id, mode, now, now],
  )
}

describe('modeCompletionHandler', () => {
  let db: Database
  let bus: EngineEventBus

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
    bus = new EngineEventBus()
  })

  test('priority is 40', () => {
    expect(modeCompletionHandler.priority).toBe(40)
  })

  test('matches all events', () => {
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'x', state: 'completed', durationMs: 0 }
    expect(modeCompletionHandler.matches(ev)).toBe(true)
  })

  test('emits session.mode_completed with correct fields', async () => {
    seedSession(db, 'sess-mode', 'task')
    const ctx = makeCtx(db, bus)

    const emitted: EngineEvent[] = []
    bus.on((e) => emitted.push(e))

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'sess-mode',
      state: 'completed',
      durationMs: 500,
    }
    await modeCompletionHandler.handle(ev, ctx)

    const modeEv = emitted.find((e) => e.kind === 'session.mode_completed')
    expect(modeEv).toBeDefined()
    if (modeEv?.kind === 'session.mode_completed') {
      expect(modeEv.sessionId).toBe('sess-mode')
      expect(modeEv.mode).toBe('task')
      expect(modeEv.state).toBe('completed')
      expect(modeEv.durationMs).toBe(500)
    }
  })

  test('does nothing when session does not exist', async () => {
    const ctx = makeCtx(db, bus)
    const emitted: EngineEvent[] = []
    bus.on((e) => emitted.push(e))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'ghost', state: 'completed', durationMs: 0 }
    await modeCompletionHandler.handle(ev, ctx)

    expect(emitted.filter((e) => e.kind === 'session.mode_completed')).toHaveLength(0)
  })
})
