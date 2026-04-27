import { describe, test, expect, beforeEach, mock } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { openDatabase, prepared, runMigrations } from '../db/sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import {
  handleDagCompletion,
  registerDagCompletionHandler,
  type DagCompletedEvent,
} from './dag-completion-handler'
import type { SessionRegistry } from '../session/registry'

function createTestDb(): Database {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return db
}

function createMockRegistry(): SessionRegistry {
  return {
    reply: mock(async () => true),
    create: mock(async () => ({ session: {} as never, runtime: {} as never })),
    get: mock(() => undefined),
    getBySlug: mock(() => undefined),
    list: mock(() => []),
    snapshot: mock(() => undefined),
    stop: mock(async () => {}),
    close: mock(async () => {}),
    reconcileOnBoot: mock(async () => {}),
    scheduleQuotaResume: mock(async () => {}),
  }
}

function insertShipRoot(db: Database, id: string, stage: 'think' | 'plan' | 'dag' | 'verify' | 'done'): void {
  const now = Date.now()
  prepared.insertSession(db, {
    id,
    slug: id,
    status: 'running',
    command: 'ship',
    mode: 'ship',
    repo: 'https://github.com/org/repo',
    branch: 'minion/ship-root',
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: 'claude-ship',
    workspace_root: '/tmp/workspace',
    created_at: now,
    updated_at: now,
    needs_attention: false,
    attention_reasons: [],
    quick_actions: [],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    stage,
    coordinator_children: [],
  })
}

describe('dag-completion-handler', () => {
  let db: Database
  let registry: SessionRegistry
  let scheduler: { start: (id: string) => Promise<void> }

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
    registry = createMockRegistry()
    scheduler = { start: mock(async () => {}) }
  })

  test('advances a ship-root session from dag to verify', async () => {
    const rootId = 'ship-handler-root'
    insertShipRoot(db, rootId, 'dag')

    const event: DagCompletedEvent = {
      kind: 'dag.completed',
      dagId: 'dag-1',
      rootSessionId: rootId,
      status: 'completed',
    }

    await handleDagCompletion(event, { db, registry, scheduler })

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe('verify')
    expect(registry.reply).toHaveBeenCalledTimes(1)
  })

  test('also advances when DAG status is failed (preserves prior behavior)', async () => {
    const rootId = 'ship-handler-failed'
    insertShipRoot(db, rootId, 'dag')

    const event: DagCompletedEvent = {
      kind: 'dag.completed',
      dagId: 'dag-2',
      rootSessionId: rootId,
      status: 'failed',
    }

    await handleDagCompletion(event, { db, registry, scheduler })

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe('verify')
  })

  test('is a no-op for non-ship root sessions', async () => {
    const rootId = 'task-root'
    const now = Date.now()
    prepared.insertSession(db, {
      id: rootId,
      slug: rootId,
      status: 'running',
      command: 'task',
      mode: 'task',
      repo: 'https://github.com/org/repo',
      branch: null,
      bare_dir: null,
      pr_url: null,
      parent_id: null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: null,
      created_at: now,
      updated_at: now,
      needs_attention: false,
      attention_reasons: [],
      quick_actions: [],
      conversation: [],
      quota_sleep_until: null,
      quota_retry_count: 0,
      metadata: {},
      pipeline_advancing: false,
      stage: null,
      coordinator_children: [],
    })

    const event: DagCompletedEvent = {
      kind: 'dag.completed',
      dagId: 'dag-3',
      rootSessionId: rootId,
      status: 'completed',
    }

    await handleDagCompletion(event, { db, registry, scheduler })

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBeFalsy()
    expect(registry.reply).toHaveBeenCalledTimes(0)
  })

  test('is a no-op when ship root is not in dag stage', async () => {
    const rootId = 'ship-handler-think'
    insertShipRoot(db, rootId, 'think')

    const event: DagCompletedEvent = {
      kind: 'dag.completed',
      dagId: 'dag-4',
      rootSessionId: rootId,
      status: 'completed',
    }

    await handleDagCompletion(event, { db, registry, scheduler })

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe('think')
    expect(registry.reply).toHaveBeenCalledTimes(0)
  })

  test('swallows errors thrown by advanceShip so the bus listener does not break', async () => {
    const rootId = 'ship-handler-errors'
    insertShipRoot(db, rootId, 'dag')

    const throwingRegistry = createMockRegistry()
    throwingRegistry.reply = mock(async () => {
      throw new Error('boom')
    })

    const event: DagCompletedEvent = {
      kind: 'dag.completed',
      dagId: 'dag-5',
      rootSessionId: rootId,
      status: 'completed',
    }

    await expect(
      handleDagCompletion(event, { db, registry: throwingRegistry, scheduler }),
    ).resolves.toBeUndefined()
  })

  test('registerDagCompletionHandler subscribes to dag.completed events on the bus', async () => {
    const rootId = 'ship-handler-bus'
    insertShipRoot(db, rootId, 'dag')

    const bus = new EngineEventBus()
    const off = registerDagCompletionHandler(bus, { db, registry, scheduler })

    bus.emit({
      kind: 'dag.completed',
      dagId: 'dag-bus',
      rootSessionId: rootId,
      status: 'completed',
    })

    await new Promise((r) => setTimeout(r, 10))

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe('verify')

    off()
  })

  test('returned unsubscribe stops the handler from reacting', async () => {
    const rootId = 'ship-handler-unsub'
    insertShipRoot(db, rootId, 'dag')

    const bus = new EngineEventBus()
    const off = registerDagCompletionHandler(bus, { db, registry, scheduler })
    off()

    bus.emit({
      kind: 'dag.completed',
      dagId: 'dag-bus-unsub',
      rootSessionId: rootId,
      status: 'completed',
    })

    await new Promise((r) => setTimeout(r, 10))

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe('dag')
  })
})
