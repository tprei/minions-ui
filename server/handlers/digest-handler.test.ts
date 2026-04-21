import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { digestHandler } from './digest-handler'
import type { HandlerCtx, SessionCompletedEvent, DigestBuilder } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'
function makeDigestBuilder(body: string): DigestBuilder {
  return {
    build: async () => body,
  }
}

function makeCtx(db: Database, digest: DigestBuilder): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest,
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, prUrl: string | null = null, workspaceRoot: string | null = null): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'my-slug', 'completed', 'cmd', 'task', null, null, null, ?, null, null, null, ?, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    [id, prUrl, workspaceRoot, now, now],
  )
}

describe('digestHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('priority is 0', () => {
    expect(digestHandler.priority).toBe(0)
  })

  test('does nothing when pr_url is null', async () => {
    seedSession(db, 'sess-no-pr', null, '/ws')
    const builtCalls: string[] = []
    const digest: DigestBuilder = {
      build: async (id) => { builtCalls.push(id); return '' },
    }
    const ctx = makeCtx(db, digest)
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-pr', state: 'completed', durationMs: 0 }
    await digestHandler.handle(ev, ctx)

    expect(builtCalls).toHaveLength(0)
  })

  test('does nothing when workspace_root is null', async () => {
    seedSession(db, 'sess-no-ws', 'https://github.com/org/repo/pull/1', null)
    const builtCalls: string[] = []
    const digest: DigestBuilder = {
      build: async (id) => { builtCalls.push(id); return '' },
    }
    const ctx = makeCtx(db, digest)
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-ws', state: 'completed', durationMs: 0 }
    await digestHandler.handle(ev, ctx)

    expect(builtCalls).toHaveLength(0)
  })

  test('does nothing when digest.build returns empty string', async () => {
    seedSession(db, 'sess-empty', 'https://github.com/org/repo/pull/1', '/ws')
    const ctx = makeCtx(db, makeDigestBuilder(''))
    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-empty', state: 'completed', durationMs: 0 }
    await digestHandler.handle(ev, ctx)
  })
})
