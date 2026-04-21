import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { parentNotifyHandler } from './parent-notify-handler'
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

function makeScheduler(calls: Array<{ sessionId: string; state: string }>): DagScheduler {
  return {
    onSessionCompleted: async (sessionId, state) => {
      calls.push({ sessionId, state })
    },
  }
}

function makeCtx(db: Database, schedulerCalls: Array<{ sessionId: string; state: string }>): HandlerCtx {
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

function seedSession(db: Database, id: string, metadata: Record<string, unknown> = {}): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', 'task', null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, ?, 0)`,
    [id, now, now, JSON.stringify(metadata)],
  )
}

describe('parentNotifyHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 0', () => {
    expect(parentNotifyHandler.priority).toBe(0)
  })

  test('calls scheduler.onSessionCompleted when dagNodeId is set', async () => {
    seedSession(db, 'sess-dag-node', { dagNodeId: 'node-abc' })
    const calls: Array<{ sessionId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-dag-node', state: 'completed', durationMs: 0 }
    await parentNotifyHandler.handle(ev, ctx)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.sessionId).toBe('sess-dag-node')
    expect(calls[0]!.state).toBe('completed')
  })

  test('does nothing when dagNodeId is not set', async () => {
    seedSession(db, 'sess-no-node', {})
    const calls: Array<{ sessionId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-node', state: 'completed', durationMs: 0 }
    await parentNotifyHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })

  test('does nothing for unknown session', async () => {
    const calls: Array<{ sessionId: string; state: string }> = []
    const ctx = makeCtx(db, calls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'ghost', state: 'completed', durationMs: 0 }
    await parentNotifyHandler.handle(ev, ctx)

    expect(calls).toHaveLength(0)
  })
})
