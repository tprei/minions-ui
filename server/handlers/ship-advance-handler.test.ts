import { describe, test, expect, beforeEach, mock, vi } from 'bun:test'
import { Database } from 'bun:sqlite'

mock.module('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { shipAdvanceHandler } from './ship-advance-handler'
import type { HandlerCtx, SessionCompletedEvent } from './types'
import type { SessionRegistry } from '../session/registry'
import type { SpawnedChild } from '../dag/claude-extract'
import { spawn } from 'node:child_process'
import {
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'

const mockSpawn = spawn as ReturnType<typeof vi.fn>

function makeEmptyChild(): SpawnedChild {
  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from('[]'))
      }),
    },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0)
    }),
    kill: vi.fn(),
  }
}

function makeRegistry(calls: {
  stop: string[]
  create: Array<{ mode: string; prompt: string; parentId?: string }>
}): SessionRegistry {
  return {
    create: async (opts) => {
      calls.create.push({ mode: opts.mode, prompt: opts.prompt, parentId: opts.parentId })
      return {
        session: {
          id: `spawned-${calls.create.length}`,
          slug: `spawned-slug-${calls.create.length}`,
          status: 'running',
          command: opts.prompt,
          mode: opts.mode,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childIds: [],
          needsAttention: false,
          attentionReasons: [],
          quickActions: [],
          conversation: [],
        },
        runtime: undefined as never,
      }
    },
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => [],
    snapshot: () => undefined,
    stop: async (sessionId: string) => { calls.stop.push(sessionId) },
    close: async () => {},
    reply: async () => true,
    reconcileOnBoot: async () => {},
    scheduleQuotaResume: async () => {},
  }
}

function makeCtx(
  db: Database,
  registryCalls: { stop: string[]; create: Array<{ mode: string; prompt: string; parentId?: string }> },
  schedulerCalls: { start: string[]; onSessionCompleted: string[] },
): HandlerCtx {
  const bus = new EngineEventBus()
  return {
    db,
    registry: makeRegistry(registryCalls),
    bus,
    scheduler: {
      async start(dagId: string) { schedulerCalls.start.push(dagId) },
      async onSessionCompleted(sessionId: string) { schedulerCalls.onSessionCompleted.push(sessionId) },
    },
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
     VALUES (?, ?, 'completed', 'cmd', ?, 'https://github.com/org/repo', null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', ?)`,
    [id, `slug-${id}`, mode, now, now, pipelineAdvancing ? 1 : 0],
  )
}

function seedAssistantMessage(db: Database, sessionId: string, text: string): void {
  const now = Date.now()
  db.run(
    `INSERT INTO session_events (session_id, seq, turn, type, timestamp, payload)
     VALUES (?, 1, 1, 'assistant_text', ?, ?)`,
    [sessionId, now, JSON.stringify({ blockId: 'block-1', text, final: true })],
  )
}

describe('shipAdvanceHandler', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
    vi.clearAllMocks()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mockSpawn.mockImplementation(() => makeEmptyChild())
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

  // TODO: Re-enable once ship coordinator advanceShip logic is implemented
  // The old ship-think/ship-plan modes were removed in favor of the new 'ship' coordinator mode
  test.skip('spawns ship-plan session when ship-think completes', async () => {
    seedSession(db, 'sess-think', 'ship-think')
    seedAssistantMessage(db, 'sess-think', 'Design doc: build an auth service')

    const registryCalls = { stop: [] as string[], create: [] as Array<{ mode: string; prompt: string; parentId?: string }> }
    const schedulerCalls = { start: [] as string[], onSessionCompleted: [] as string[] }
    const ctx = makeCtx(db, registryCalls, schedulerCalls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-think', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(registryCalls.create).toHaveLength(1)
    expect(registryCalls.create[0]?.mode).toBe('ship-plan')
    expect(registryCalls.create[0]?.prompt).toContain('Design doc')
    expect(registryCalls.create[0]?.parentId).toBe('sess-think')
    expect(schedulerCalls.start).toHaveLength(0)
  })

  test('skips non-ship-advance modes', async () => {
    seedSession(db, 'sess-task', 'task')
    const registryCalls = { stop: [] as string[], create: [] as Array<{ mode: string; prompt: string; parentId?: string }> }
    const schedulerCalls = { start: [] as string[], onSessionCompleted: [] as string[] }
    const ctx = makeCtx(db, registryCalls, schedulerCalls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-task', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(registryCalls.create).toHaveLength(0)
    expect(schedulerCalls.start).toHaveLength(0)
  })

  test('skips ship-verify (handled elsewhere)', async () => {
    seedSession(db, 'sess-verify', 'ship-verify')
    const registryCalls = { stop: [] as string[], create: [] as Array<{ mode: string; prompt: string; parentId?: string }> }
    const schedulerCalls = { start: [] as string[], onSessionCompleted: [] as string[] }
    const ctx = makeCtx(db, registryCalls, schedulerCalls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-verify', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(registryCalls.create).toHaveLength(0)
    expect(schedulerCalls.start).toHaveLength(0)
  })

  test('skips when pipeline_advancing is already set', async () => {
    seedSession(db, 'sess-advancing', 'ship-think', true)
    const registryCalls = { stop: [] as string[], create: [] as Array<{ mode: string; prompt: string; parentId?: string }> }
    const schedulerCalls = { start: [] as string[], onSessionCompleted: [] as string[] }
    const ctx = makeCtx(db, registryCalls, schedulerCalls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-advancing', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(registryCalls.create).toHaveLength(0)
    expect(schedulerCalls.start).toHaveLength(0)
  })

  test('spawns ship-verify session when ship-plan completes', async () => {
    seedSession(db, 'sess-plan', 'ship-plan')
    seedAssistantMessage(db, 'sess-plan', 'DAG of tasks: 1. implement auth, 2. add tests, 3. deploy')

    const registryCalls = { stop: [] as string[], create: [] as Array<{ mode: string; prompt: string; parentId?: string }> }
    const schedulerCalls = { start: [] as string[], onSessionCompleted: [] as string[] }
    const ctx = makeCtx(db, registryCalls, schedulerCalls)

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-plan', state: 'completed', durationMs: 0 }
    await shipAdvanceHandler.handle(ev, ctx)

    expect(registryCalls.create).toHaveLength(1)
    expect(registryCalls.create[0]?.mode).toBe('ship-verify')
    expect(registryCalls.create[0]?.prompt).toContain('DAG of tasks')
    expect(registryCalls.create[0]?.parentId).toBe('sess-plan')
    expect(schedulerCalls.start).toHaveLength(0)
  })
})
