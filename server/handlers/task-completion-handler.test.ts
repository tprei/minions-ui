import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { taskCompletionHandler } from './task-completion-handler'
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

function seedSession(db: Database, id: string, mode: string): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', ?, null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    [id, mode, now, now],
  )
}

describe('taskCompletionHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 60', () => {
    expect(taskCompletionHandler.priority).toBe(60)
  })

  test('handles task mode sessions', async () => {
    seedSession(db, 'sess-task', 'task')
    const ctx = makeCtx(db)
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-task', state: 'completed', durationMs: 0 }
    await taskCompletionHandler.handle(ev, ctx)
  })

  test('does nothing for non-task mode sessions', async () => {
    seedSession(db, 'sess-ship', 'ship')
    const qualityRunCalls: string[] = []
    const db2 = openDatabase(':memory:')
    runMigrations(db2)
    const bus = new EngineEventBus()
    const ctx: HandlerCtx = {
      db: db2,
      registry: createSessionRegistry({ getDb: () => db2 }),
      bus,
      scheduler: createNoopDagScheduler(),
      loopScheduler: createNoopLoopScheduler(),
      ciBabysitter: createNoopCIBabysitter(),
      qualityGates: {
        run: async (cwd: string) => {
          qualityRunCalls.push(cwd)
          return { allPassed: true, results: [] }
        },
      },
      digest: createNoopDigestBuilder(),
      profileStore: createNoopProfileStore(),
      replyQueue: createNoopReplyQueueFactory(),
      config: createDefaultConfig(),
    }

    seedSession(db2, 'sess-ship-2', 'ship')
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-ship-2', state: 'completed', durationMs: 0 }
    await taskCompletionHandler.handle(ev, ctx)

    expect(qualityRunCalls).toHaveLength(0)
    db2.close()
  })
})
