import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { openDatabase, prepared, runMigrations } from '../db/sqlite'
import { advanceShip, DIRECTIVE_PLAN, DIRECTIVE_VERIFY } from './coordinator'
import type { PlanActionCtx } from '../commands/plan-actions'
import type { SessionRegistry } from '../session/registry'
import { getEventBus, resetEventBus } from '../events/bus'
import type { ShipStage } from '../../shared/api-types'

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
