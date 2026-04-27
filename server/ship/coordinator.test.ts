import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { openDatabase, prepared, runMigrations } from '../db/sqlite'
import { advanceShip, cancelShip, DIRECTIVE_PLAN, DIRECTIVE_VERIFY, reconcileShipsOnBoot } from './coordinator'
import type { PlanActionCtx } from '../commands/plan-actions'
import type { SessionRegistry } from '../session/registry'
import { getEventBus, resetEventBus } from '../events/bus'
import type { ShipStage } from '../../shared/api-types'
import { buildDag } from '../dag/dag'
import { saveDag, loadDag } from '../dag/store'

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

function createMockScheduler() {
  return {
    start: mock(async () => {}),
  }
}

const DAG_MARKDOWN = [
  '```json',
  '[',
  '  {',
  '    "id": "implement-api",',
  '    "title": "Implement API",',
  '    "description": "Add the API changes.",',
  '    "dependsOn": []',
  '  }',
  ']',
  '```',
].join('\n')

function insertDagPlan(db: Database, sessionId: string): void {
  const now = Date.now()
  prepared.insertEvent(db, {
    session_id: sessionId,
    seq: prepared.nextSeq(db, sessionId),
    turn: 1,
    type: 'assistant_text',
    timestamp: now,
    payload: {
      id: `${sessionId}-plan`,
      sessionId,
      seq: 1,
      turn: 1,
      timestamp: now,
      type: 'assistant_text',
      blockId: 'plan',
      text: DAG_MARKDOWN,
      final: true,
    },
  })
}

function createSession(db: Database, sessionId: string, mode: string, stage: ShipStage | null) {
  const now = Date.now()
  const slug = `test-ship-${sessionId.split('-')[1]}`

  prepared.insertSession(db, {
    id: sessionId,
    slug,
    status: 'running',
    command: 'ship this feature',
    mode,
    repo: 'https://github.com/test/repo',
    branch: 'minion/test-1234',
    bare_dir: '/tmp/bare',
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: 'claude-123',
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
    stage: null,
    coordinator_children: [],
  })

  // Set stage via direct SQL since prepared.insertSession doesn't include it yet
  if (stage !== null) {
    db.run('UPDATE sessions SET stage = ? WHERE id = ?', [stage, sessionId])
  }
}

describe('advanceShip', () => {
  let db: Database
  let registry: SessionRegistry
  let scheduler: ReturnType<typeof createMockScheduler>
  let ctx: PlanActionCtx

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
    registry = createMockRegistry()
    scheduler = createMockScheduler()
    ctx = { db, registry, scheduler }
  })

  describe('valid transitions', () => {
    test('think → plan', async () => {
      const sessionId = 'session-1'
      createSession(db, sessionId, 'ship', 'think')

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('think')
      expect(result.to).toBe('plan')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan')
      expect(registry.reply).toHaveBeenCalledWith(sessionId, DIRECTIVE_PLAN)
    })

    test('plan → dag', async () => {
      const sessionId = 'session-2'
      createSession(db, sessionId, 'ship', 'plan')
      insertDagPlan(db, sessionId)

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('plan')
      expect(result.to).toBe('dag')
      expect(result.dagId).toBeDefined()

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('dag')
      expect(registry.reply).not.toHaveBeenCalled()
      expect(scheduler.start).toHaveBeenCalledWith(result.dagId)
      expect(prepared.listDags(db)).toHaveLength(1)
    })

    test('plan → dag requires a parseable DAG plan', async () => {
      const sessionId = 'session-2b'
      createSession(db, sessionId, 'ship', 'plan')

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('no markdown provided')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan')
      expect(scheduler.start).not.toHaveBeenCalled()
    })

    test('dag → verify', async () => {
      const sessionId = 'session-3'
      createSession(db, sessionId, 'ship', 'dag')

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('dag')
      expect(result.to).toBe('verify')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('verify')
      expect(registry.reply).toHaveBeenCalledWith(sessionId, DIRECTIVE_VERIFY)
    })

    test('verify → done', async () => {
      const sessionId = 'session-4'
      createSession(db, sessionId, 'ship', 'verify')

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('verify')
      expect(result.to).toBe('done')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('done')
      expect(row?.status).toBe('completed')
      expect(registry.reply).not.toHaveBeenCalled()
    })

    test('explicit target stage (think → plan)', async () => {
      const sessionId = 'session-5'
      createSession(db, sessionId, 'ship', 'think')

      const result = await advanceShip(sessionId, 'plan', ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('think')
      expect(result.to).toBe('plan')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan')
    })

    test('defaults to think when stage is null', async () => {
      const sessionId = 'session-6'
      createSession(db, sessionId, 'ship', null)

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('think')
      expect(result.to).toBe('plan')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan')
    })
  })

  describe('invalid transitions', () => {
    test('rejects skip-ahead transition (think → dag)', async () => {
      const sessionId = 'session-7'
      createSession(db, sessionId, 'ship', 'think')

      const result = await advanceShip(sessionId, 'dag', ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('invalid transition')
      expect(result.reason).toContain('think')
      expect(result.reason).toContain('dag')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('think') // unchanged
    })

    test('rejects backward transition (plan → think)', async () => {
      const sessionId = 'session-8'
      createSession(db, sessionId, 'ship', 'plan')

      const result = await advanceShip(sessionId, 'think', ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('invalid transition')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan') // unchanged
    })

    test('rejects transition from done', async () => {
      const sessionId = 'session-9'
      createSession(db, sessionId, 'ship', 'done')

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('no valid next stage')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('done') // unchanged
    })

    test('rejects non-ship mode', async () => {
      const sessionId = 'session-10'
      createSession(db, sessionId, 'task', null)

      const result = await advanceShip(sessionId, undefined, ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('not ship')
    })

    test('rejects non-existent session', async () => {
      const result = await advanceShip('nonexistent', undefined, ctx)

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('session not found')
    })
  })

  describe('idempotent repeats', () => {
    test('same stage returns ok without change (think → think)', async () => {
      const sessionId = 'session-11'
      createSession(db, sessionId, 'ship', 'think')

      const result = await advanceShip(sessionId, 'think', ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('think')
      expect(result.to).toBe('think')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('think')
      expect(registry.reply).not.toHaveBeenCalled()
    })

    test('same stage returns ok without change (plan → plan)', async () => {
      const sessionId = 'session-12'
      createSession(db, sessionId, 'ship', 'plan')

      const result = await advanceShip(sessionId, 'plan', ctx)

      expect(result.ok).toBe(true)
      expect(result.from).toBe('plan')
      expect(result.to).toBe('plan')

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('plan')
    })
  })

  describe('mutex serialization', () => {
    test('serializes concurrent advance calls on same session', async () => {
      const sessionId = 'session-13'
      createSession(db, sessionId, 'ship', 'think')

      const updateCount: number[] = []

      // Track number of concurrent updates
      const originalRun = db.run.bind(db)
      db.run = mock((sql: string, ...args: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('UPDATE sessions SET stage')) {
          updateCount.push(Date.now())
        }
        return originalRun(sql, ...(args as Parameters<typeof originalRun>[1][]))
      }) as typeof db.run

      insertDagPlan(db, sessionId)

      const [result1, result2] = await Promise.all([
        advanceShip(sessionId, undefined, ctx),
        advanceShip(sessionId, undefined, ctx),
      ])

      db.run = originalRun as typeof db.run

      expect(result1.ok).toBe(true)
      expect(result2.ok).toBe(true)

      expect(updateCount.length).toBe(2)

      const row = prepared.getSession(db, sessionId)
      expect(row?.stage).toBe('dag')
    })

    test('concurrent advances on different sessions do not block each other', async () => {
      const sessionId1 = 'session-14'
      const sessionId2 = 'session-15'
      createSession(db, sessionId1, 'ship', 'think')
      createSession(db, sessionId2, 'ship', 'dag')

      const startTimes: Record<string, number> = {}
      const endTimes: Record<string, number> = {}

      // Both transitions inject directives (think→plan and dag→verify)
      const trackedReply = mock(async (sid: string) => {
        startTimes[sid] = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 30))
        endTimes[sid] = Date.now()
        return true
      })
      ;(registry.reply as unknown as typeof trackedReply) = trackedReply

      const [result1, result2] = await Promise.all([
        advanceShip(sessionId1, undefined, ctx),
        advanceShip(sessionId2, undefined, ctx),
      ])

      expect(result1.ok).toBe(true)
      expect(result2.ok).toBe(true)

      // Both sessions should have called reply (different sessions don't block each other)
      expect(Object.keys(startTimes).length).toBe(2)
      expect(Object.keys(endTimes).length).toBe(2)

      // Sessions should overlap (second starts before first ends)
      const sessions = Object.keys(startTimes)
      const latestStart = Math.max(...sessions.map((s) => startTimes[s]!))
      const earliestEnd = Math.min(...sessions.map((s) => endTimes[s]!))

      // Latest start should be before earliest end (overlap)
      expect(latestStart).toBeLessThan(earliestEnd)
    })
  })

  describe('SSE event emission', () => {
    test('emits session.snapshot event on transition', async () => {
      const sessionId = 'session-16'
      createSession(db, sessionId, 'ship', 'think')

      const bus = getEventBus()
      const events: { session: { id: string; stage?: string } }[] = []
      bus.onKind('session.snapshot', (e) => events.push(e as { session: { id: string; stage?: string } }))

      await advanceShip(sessionId, undefined, ctx)

      expect(events.length).toBe(1)
      expect(events[0]!.session.id).toBe(sessionId)
      expect(events[0]!.session.stage).toBe('plan')
    })
  })

  describe('directive injection', () => {
    test('injects DIRECTIVE_PLAN for think → plan', async () => {
      const sessionId = 'session-17'
      createSession(db, sessionId, 'ship', 'think')

      await advanceShip(sessionId, 'plan', ctx)

      expect(registry.reply).toHaveBeenCalledTimes(1)
      expect(registry.reply).toHaveBeenCalledWith(sessionId, DIRECTIVE_PLAN)
    })

    test('injects DIRECTIVE_VERIFY for dag → verify', async () => {
      const sessionId = 'session-18'
      createSession(db, sessionId, 'ship', 'dag')

      await advanceShip(sessionId, 'verify', ctx)

      expect(registry.reply).toHaveBeenCalledTimes(1)
      expect(registry.reply).toHaveBeenCalledWith(sessionId, DIRECTIVE_VERIFY)
    })

    test('no injection for plan → dag', async () => {
      const sessionId = 'session-19'
      createSession(db, sessionId, 'ship', 'plan')
      insertDagPlan(db, sessionId)

      await advanceShip(sessionId, 'dag', ctx)

      expect(registry.reply).not.toHaveBeenCalled()
    })

    test('no injection for verify → done', async () => {
      const sessionId = 'session-20'
      createSession(db, sessionId, 'ship', 'verify')

      await advanceShip(sessionId, 'done', ctx)

      expect(registry.reply).not.toHaveBeenCalled()
    })

    test('no injection for idempotent repeat', async () => {
      const sessionId = 'session-21'
      createSession(db, sessionId, 'ship', 'plan')

      await advanceShip(sessionId, 'plan', ctx)

      expect(registry.reply).not.toHaveBeenCalled()
    })
  })

  describe('logging', () => {
    test('logs stage transition to console', async () => {
      const sessionId = 'session-22'
      createSession(db, sessionId, 'ship', 'think')

      const consoleLogSpy = spyOn(console, 'log')

      await advanceShip(sessionId, undefined, ctx)

      expect(consoleLogSpy).toHaveBeenCalledWith('[ship]', sessionId, 'stage', 'think', '->', 'plan')

      consoleLogSpy.mockRestore()
    })

    test('logs every stage transition', async () => {
      const sessionId = 'session-23'
      createSession(db, sessionId, 'ship', 'think')

      const consoleLogSpy = spyOn(console, 'log')

      // think → plan
      await advanceShip(sessionId, undefined, ctx)
      expect(consoleLogSpy).toHaveBeenCalledWith('[ship]', sessionId, 'stage', 'think', '->', 'plan')

      // plan → dag
      insertDagPlan(db, sessionId)
      await advanceShip(sessionId, undefined, ctx)
      expect(consoleLogSpy).toHaveBeenCalledWith('[ship]', sessionId, 'stage', 'plan', '->', 'dag')

      // dag → verify
      await advanceShip(sessionId, undefined, ctx)
      expect(consoleLogSpy).toHaveBeenCalledWith('[ship]', sessionId, 'stage', 'dag', '->', 'verify')

      // verify → done
      await advanceShip(sessionId, undefined, ctx)
      expect(consoleLogSpy).toHaveBeenCalledWith('[ship]', sessionId, 'stage', 'verify', '->', 'done')

      expect(consoleLogSpy).toHaveBeenCalledTimes(4)

      consoleLogSpy.mockRestore()
    })
  })
})

describe('cancelShip', () => {
  let db: Database
  let registry: SessionRegistry
  let scheduler: ReturnType<typeof createMockScheduler> & { cancel: ReturnType<typeof mock> }
  let ctx: PlanActionCtx

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
    registry = createMockRegistry()
    const baseScheduler = createMockScheduler()
    scheduler = {
      ...baseScheduler,
      cancel: mock(async () => {}),
    }
    ctx = { db, registry, scheduler }
  })

  test('rejects when session does not exist', async () => {
    const result = await cancelShip('does-not-exist', ctx)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('session not found')
  })

  test('rejects when session is not in ship mode', async () => {
    const sessionId = 'cancel-not-ship'
    createSession(db, sessionId, 'task', null)

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not ship')
  })

  test('marks ship session as failed and records cancellation', async () => {
    const sessionId = 'cancel-no-dag'
    createSession(db, sessionId, 'ship', 'think')

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(true)
    expect(result.dagId).toBeUndefined()
    expect(result.cancelledChildren).toEqual([])

    const row = prepared.getSession(db, sessionId)
    expect(row?.status).toBe('failed')
    expect(registry.stop).toHaveBeenCalledWith(sessionId, 'ship cancelled')
  })

  test('cascades cancellation through the DAG to scheduler.cancel', async () => {
    const sessionId = 'cancel-with-dag'
    createSession(db, sessionId, 'ship', 'dag')

    const childId = 'child-running-1'
    createSession(db, childId, 'dag-task', null)

    const dagId = 'dag-for-ship-cancel'
    const graph = buildDag(dagId, [
      { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
      { id: 'b', title: 'Task B', description: 'B', dependsOn: ['a'] },
    ], sessionId, 'https://github.com/org/repo')
    graph.nodes[0]!.status = 'running'
    graph.nodes[0]!.sessionId = childId
    saveDag(graph, db)

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(true)
    expect(result.dagId).toBe(dagId)
    expect(result.cancelledChildren).toContain(childId)

    expect(scheduler.cancel).toHaveBeenCalledWith(dagId)

    const row = prepared.getSession(db, sessionId)
    expect(row?.status).toBe('failed')
  })

  test('reports children that were running when cancelled', async () => {
    const sessionId = 'cancel-list-children'
    createSession(db, sessionId, 'ship', 'dag')
    createSession(db, 's-a', 'dag-task', null)
    createSession(db, 's-b', 'dag-task', null)
    createSession(db, 's-c', 'dag-task', null)

    const dagId = 'dag-children'
    const graph = buildDag(dagId, [
      { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
      { id: 'b', title: 'Task B', description: 'B', dependsOn: [] },
      { id: 'c', title: 'Task C', description: 'C', dependsOn: [] },
      { id: 'd', title: 'Task D', description: 'D', dependsOn: [] },
    ], sessionId, 'https://github.com/org/repo')
    graph.nodes[0]!.status = 'running'
    graph.nodes[0]!.sessionId = 's-a'
    graph.nodes[1]!.status = 'ci-pending'
    graph.nodes[1]!.sessionId = 's-b'
    graph.nodes[2]!.status = 'done'
    graph.nodes[2]!.sessionId = 's-c'
    graph.nodes[3]!.status = 'pending'
    saveDag(graph, db)

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(true)
    expect(result.cancelledChildren).toEqual(expect.arrayContaining(['s-a', 's-b']))
    expect(result.cancelledChildren).not.toContain('s-c')
  })

  test('cancelShip works when scheduler does not implement cancel', async () => {
    const sessionId = 'cancel-no-scheduler-cancel'
    createSession(db, sessionId, 'ship', 'dag')

    const dagId = 'dag-no-cancel'
    const graph = buildDag(dagId, [
      { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
    ], sessionId, 'https://github.com/org/repo')
    saveDag(graph, db)

    const baseScheduler = createMockScheduler()
    const ctxWithoutCancel: PlanActionCtx = { db, registry, scheduler: baseScheduler }

    const result = await cancelShip(sessionId, ctxWithoutCancel)
    expect(result.ok).toBe(true)
    expect(result.dagId).toBe(dagId)
  })

  test('cancelShip is idempotent on already-completed ship', async () => {
    const sessionId = 'cancel-completed'
    createSession(db, sessionId, 'ship', 'done')
    db.run('UPDATE sessions SET status = ? WHERE id = ?', ['completed', sessionId])

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(true)

    const row = prepared.getSession(db, sessionId)
    expect(row?.status).toBe('completed')
  })

  test('emits a session.snapshot for the cancelled ship', async () => {
    const sessionId = 'cancel-emits-snapshot'
    createSession(db, sessionId, 'ship', 'dag')

    const bus = getEventBus()
    const events: { session: { id: string; status: string } }[] = []
    bus.onKind('session.snapshot', (e) => events.push(e as { session: { id: string; status: string } }))

    await cancelShip(sessionId, ctx)

    expect(events.find((e) => e.session.id === sessionId)?.session.status).toBe('failed')
  })

  test('persists DAG node cancellation through cancelShip → scheduler.cancel', async () => {
    const sessionId = 'cancel-persist-children'
    createSession(db, sessionId, 'ship', 'dag')

    const dagId = 'dag-persist-children'
    const graph = buildDag(dagId, [
      { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
      { id: 'b', title: 'Task B', description: 'B', dependsOn: ['a'] },
    ], sessionId, 'https://github.com/org/repo')
    saveDag(graph, db)

    // Stand-in scheduler.cancel that delegates to the real DAG store mutation
    scheduler.cancel = mock(async (id: string) => {
      const g = loadDag(id, db)
      if (!g) return
      for (const node of g.nodes) {
        if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
          node.status = 'cancelled'
          node.error = 'dag cancelled'
        }
      }
      saveDag(g, db)
    })

    const result = await cancelShip(sessionId, ctx)
    expect(result.ok).toBe(true)

    const reloaded = loadDag(dagId, db)
    expect(reloaded!.nodes.find((n) => n.id === 'a')?.status).toBe('cancelled')
    expect(reloaded!.nodes.find((n) => n.id === 'b')?.status).toBe('cancelled')
  })
})

describe('reconcileShipsOnBoot', () => {
  let db: Database
  let registry: SessionRegistry
  let scheduler: ReturnType<typeof createMockScheduler>
  let ctx: PlanActionCtx

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
    registry = createMockRegistry()
    scheduler = createMockScheduler()
    ctx = { db, registry, scheduler }
  })

  function makeCompleteDag(dagId: string, rootSessionId: string, opts?: { allDone?: boolean; failed?: boolean }): void {
    const allDone = opts?.allDone ?? true
    const failed = opts?.failed ?? false
    const graph = buildDag(
      dagId,
      [
        { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
        { id: 'b', title: 'Task B', description: 'B', dependsOn: ['a'] },
      ],
      rootSessionId,
      'https://github.com/test/repo',
    )
    if (allDone) {
      graph.nodes[0]!.status = 'done'
      graph.nodes[0]!.branch = 'minion/task-a'
      graph.nodes[1]!.status = failed ? 'failed' : 'done'
      if (!failed) graph.nodes[1]!.branch = 'minion/task-b'
    }
    saveDag(graph, db)
  }

  function makeRunningDag(dagId: string, rootSessionId: string): void {
    const graph = buildDag(
      dagId,
      [
        { id: 'a', title: 'Task A', description: 'A', dependsOn: [] },
        { id: 'b', title: 'Task B', description: 'B', dependsOn: ['a'] },
      ],
      rootSessionId,
      'https://github.com/test/repo',
    )
    graph.nodes[0]!.status = 'done'
    graph.nodes[1]!.status = 'running'
    saveDag(graph, db)
  }

  test('advances stuck ship from dag to verify when DAG is fully complete', async () => {
    const sessionId = 'session-stuck-1'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-recover-1', sessionId)

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(1)
    expect(result.advanced).toEqual([
      { sessionId, from: 'dag', to: 'verify' },
    ])
    expect(result.failures).toEqual([])

    const row = prepared.getSession(db, sessionId)
    expect(row?.stage).toBe('verify')

    expect(registry.reply).toHaveBeenCalledTimes(1)
    const replyMock = registry.reply as unknown as ReturnType<typeof mock>
    const [calledSessionId, directive] = replyMock.mock.calls[0] as [string, string]
    expect(calledSessionId).toBe(sessionId)
    expect(directive).toContain('Task A')
    expect(directive).toContain('Task B')
    expect(directive).toContain('minion/task-a')
    expect(directive).toContain('minion/task-b')
  })

  test('advances stuck ship even when DAG ended in failure (all nodes terminal)', async () => {
    const sessionId = 'session-stuck-fail'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-recover-fail', sessionId, { allDone: true, failed: true })

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.advanced).toHaveLength(1)
    expect(result.advanced[0]).toEqual({ sessionId, from: 'dag', to: 'verify' })

    const row = prepared.getSession(db, sessionId)
    expect(row?.stage).toBe('verify')
  })

  test('leaves ship at dag stage when DAG still has running nodes', async () => {
    const sessionId = 'session-running-dag'
    createSession(db, sessionId, 'ship', 'dag')
    makeRunningDag('dag-still-running', sessionId)

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(1)
    expect(result.advanced).toEqual([])
    expect(result.failures).toEqual([])

    const row = prepared.getSession(db, sessionId)
    expect(row?.stage).toBe('dag')
    expect(registry.reply).not.toHaveBeenCalled()
  })

  test('skips ships not in dag stage', async () => {
    const thinkSession = 'ship-think'
    const planSession = 'ship-plan'
    const verifySession = 'ship-verify'
    createSession(db, thinkSession, 'ship', 'think')
    createSession(db, planSession, 'ship', 'plan')
    createSession(db, verifySession, 'ship', 'verify')
    makeCompleteDag('dag-think', thinkSession)
    makeCompleteDag('dag-plan', planSession)
    makeCompleteDag('dag-verify', verifySession)

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(3)
    expect(result.advanced).toEqual([])
    expect(registry.reply).not.toHaveBeenCalled()
    expect(prepared.getSession(db, thinkSession)?.stage).toBe('think')
    expect(prepared.getSession(db, planSession)?.stage).toBe('plan')
    expect(prepared.getSession(db, verifySession)?.stage).toBe('verify')
  })

  test('skips ships with stage=dag but no associated DAG row', async () => {
    const sessionId = 'session-no-dag'
    createSession(db, sessionId, 'ship', 'dag')

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(1)
    expect(result.advanced).toEqual([])
    expect(result.failures).toEqual([])

    const row = prepared.getSession(db, sessionId)
    expect(row?.stage).toBe('dag')
  })

  test('ignores non-ship sessions', async () => {
    const taskSession = 'task-1'
    createSession(db, taskSession, 'task', null)

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(0)
    expect(result.advanced).toEqual([])
  })

  test('skips ships already marked completed', async () => {
    const sessionId = 'session-already-completed'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-already-done', sessionId)
    db.run("UPDATE sessions SET status = 'completed' WHERE id = ?", [sessionId])

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(0)
    expect(result.advanced).toEqual([])
    expect(registry.reply).not.toHaveBeenCalled()
  })

  test('skips ships already marked failed', async () => {
    const sessionId = 'session-already-failed'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-already-failed', sessionId)
    db.run("UPDATE sessions SET status = 'failed' WHERE id = ?", [sessionId])

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(0)
    expect(result.advanced).toEqual([])
  })

  test('handles multiple stuck ships in one pass', async () => {
    const sessionA = 'multi-aaa'
    const sessionB = 'multi-bbb'
    const sessionC = 'multi-ccc'
    createSession(db, sessionA, 'ship', 'dag')
    createSession(db, sessionB, 'ship', 'dag')
    createSession(db, sessionC, 'ship', 'dag')
    makeCompleteDag('dag-multi-a', sessionA)
    makeRunningDag('dag-multi-b', sessionB)
    makeCompleteDag('dag-multi-c', sessionC)

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(3)
    expect(result.advanced).toHaveLength(2)
    const advancedIds = result.advanced.map((a) => a.sessionId).sort()
    expect(advancedIds).toEqual([sessionA, sessionC].sort())

    expect(prepared.getSession(db, sessionA)?.stage).toBe('verify')
    expect(prepared.getSession(db, sessionB)?.stage).toBe('dag')
    expect(prepared.getSession(db, sessionC)?.stage).toBe('verify')
  })

  test('emits session.snapshot event for each advanced ship', async () => {
    const sessionId = 'session-snapshot-emit'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-snapshot', sessionId)

    const events: Array<{ id: string; stage?: string }> = []
    getEventBus().onKind('session.snapshot', (e) => {
      events.push({ id: e.session.id, stage: e.session.stage })
    })

    await reconcileShipsOnBoot(ctx)

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ id: sessionId, stage: 'verify' })
  })

  test('reports failures when advance throws and continues with other ships', async () => {
    const sessionGood = 'ship-good'
    const sessionBad = 'ship-bad'
    createSession(db, sessionGood, 'ship', 'dag')
    createSession(db, sessionBad, 'ship', 'dag')
    makeCompleteDag('dag-good', sessionGood)
    makeCompleteDag('dag-bad', sessionBad)

    const realReply = registry.reply
    let callCount = 0
    registry.reply = mock(async (id: string, text: string) => {
      callCount++
      if (id === sessionBad) throw new Error('injection failed')
      return (realReply as unknown as (sid: string, t: string) => Promise<boolean>)(id, text)
    }) as typeof registry.reply

    const consoleErrorSpy = spyOn(console, 'error')

    const result = await reconcileShipsOnBoot(ctx)

    expect(result.scanned).toBe(2)
    expect(result.advanced).toHaveLength(1)
    expect(result.advanced[0]?.sessionId).toBe(sessionGood)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.sessionId).toBe(sessionBad)
    expect(result.failures[0]?.reason).toContain('injection failed')

    expect(callCount).toBe(2)
    consoleErrorSpy.mockRestore()
  })

  test('returns empty result when no ship sessions exist', async () => {
    const result = await reconcileShipsOnBoot(ctx)
    expect(result).toEqual({ scanned: 0, advanced: [], failures: [] })
  })

  test('uses child branch info from DAG when building verify directive', async () => {
    const sessionId = 'session-with-children'
    createSession(db, sessionId, 'ship', 'dag')

    const dagId = 'dag-with-prs'
    const graph = buildDag(
      dagId,
      [{ id: 'task-1', title: 'Implement feature', description: 'Do the thing.', dependsOn: [] }],
      sessionId,
      'https://github.com/test/repo',
    )
    graph.nodes[0]!.status = 'done'
    graph.nodes[0]!.branch = 'minion/feature-branch'
    graph.nodes[0]!.prUrl = 'https://github.com/test/repo/pull/42'
    saveDag(graph, db)

    await reconcileShipsOnBoot(ctx)

    const row = prepared.getSession(db, sessionId)
    expect(row?.stage).toBe('verify')

    expect(registry.reply).toHaveBeenCalledTimes(1)
    const replyMock = registry.reply as unknown as ReturnType<typeof mock>
    const [, directive] = replyMock.mock.calls[0] as [string, string]
    expect(directive).toContain('minion/feature-branch')
    expect(directive).toContain('https://github.com/test/repo/pull/42')
  })

  test('is idempotent: running twice does not double-advance', async () => {
    const sessionId = 'session-idempotent'
    createSession(db, sessionId, 'ship', 'dag')
    makeCompleteDag('dag-idempotent', sessionId)

    const first = await reconcileShipsOnBoot(ctx)
    expect(first.advanced).toHaveLength(1)

    const second = await reconcileShipsOnBoot(ctx)
    expect(second.advanced).toEqual([])
    expect(second.scanned).toBe(1)
  })
})
