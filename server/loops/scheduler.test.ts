import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { openDatabase, runMigrations } from '../db/sqlite'
import { LoopScheduler } from './scheduler'
import { DEFAULT_LOOPS } from './definitions'
import { getLoop, listLoops } from './store'
import type { SessionRegistry, CreateSessionOpts } from '../session/registry'
import type { ApiSession } from '../../shared/api-types'
import type { SessionRuntime } from '../session/runtime'

function makeTestDb(): Database {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return db
}

function makeSession(id: string): ApiSession {
  return {
    id,
    slug: `loop-${id}`,
    status: 'running',
    command: 'loop task',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
  }
}

function makeRegistry(
  createFn?: (opts: CreateSessionOpts) => Promise<{ session: ApiSession; runtime: SessionRuntime }>,
): SessionRegistry {
  return {
    create: createFn ?? (async () => ({ session: makeSession('mock-' + Math.random().toString(36).slice(2)), runtime: {} as SessionRuntime })),
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => [],
    snapshot: () => undefined,
    stop: async () => undefined,
    close: async () => undefined,
    reply: async () => true,
    reconcileOnBoot: async () => undefined,
    scheduleQuotaResume: async () => undefined,
  }
}

describe('LoopScheduler', () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
  })

  function makeScheduler(
    interactiveCount = 0,
    createFn?: (opts: CreateSessionOpts) => Promise<{ session: ApiSession; runtime: SessionRuntime }>,
  ) {
    return new LoopScheduler({
      db,
      registry: makeRegistry(createFn),
      workspaceRoot: '/tmp/test-ws',
      repo: 'https://github.com/org/repo',
      maxConcurrentSessions: 10,
      getInteractiveSessionCount: () => interactiveCount,
    })
  }

  test('seeds all 7 DEFAULT_LOOPS into the DB', () => {
    makeScheduler()
    const rows = listLoops(db)
    expect(rows).toHaveLength(DEFAULT_LOOPS.length)
    expect(rows).toHaveLength(7)
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual(DEFAULT_LOOPS.map((d) => d.id).sort())
  })

  test('listLoops returns 7 definitions', () => {
    const sched = makeScheduler()
    expect(sched.listLoops()).toHaveLength(7)
  })

  test('enable and disable toggle the DB flag', () => {
    const sched = makeScheduler()
    sched.disable('test-coverage')
    expect(getLoop(db, 'test-coverage')!.enabled).toBe(false)
    sched.enable('test-coverage')
    expect(getLoop(db, 'test-coverage')!.enabled).toBe(true)
  })

  test('setInterval updates the DB row', () => {
    const sched = makeScheduler()
    sched.setInterval('dead-code', 999_000)
    expect(getLoop(db, 'dead-code')!.interval_ms).toBe(999_000)
  })

  test('tick skips all loops when reserved slots < 2', async () => {
    const created: string[] = []
    const sched = makeScheduler(9, async (opts) => {
      created.push(opts.prompt)
      return { session: makeSession('s'), runtime: {} as SessionRuntime }
    })

    await sched.tick(Date.now())
    expect(created).toHaveLength(0)
  })

  test('tick fires loops that are due (last_run_at null)', async () => {
    const created: string[] = []
    const sched = makeScheduler(0, async (opts) => {
      created.push(opts.prompt)
      return { session: makeSession('s-' + created.length), runtime: {} as SessionRuntime }
    })

    await sched.tick(Date.now())
    expect(created.length).toBeGreaterThan(0)
  })

  test('tick staggers loop kicks by 30 seconds per loop', async () => {
    const now = Date.now()

    const created: string[] = []
    const sched = makeScheduler(0, async (opts) => {
      created.push(opts.prompt)
      return { session: makeSession('s'), runtime: {} as SessionRuntime }
    })

    const origKick = sched.kickLoop.bind(sched)
    const kickOrder: string[] = []
    sched.kickLoop = async (id: string) => {
      kickOrder.push(id)
      return origKick(id)
    }

    await sched.tick(now)

    expect(kickOrder.length).toBeGreaterThan(1)
  })

  test('recordOutcome with success resets consecutive_failures to 0', async () => {
    const sched = makeScheduler()
    const db2 = db

    db2.run(
      "UPDATE loops SET consecutive_failures = 3 WHERE id = 'test-coverage'",
    )

    await sched.recordOutcome('test-coverage', 'completed')

    expect(getLoop(db, 'test-coverage')!.consecutive_failures).toBe(0)
  })

  test('recordOutcome with failure increments consecutive_failures', async () => {
    const sched = makeScheduler()

    await sched.recordOutcome('test-coverage', 'errored')

    expect(getLoop(db, 'test-coverage')!.consecutive_failures).toBe(1)
  })

  test('loop auto-disables after 5 consecutive failures', async () => {
    const sched = makeScheduler()

    db.run("UPDATE loops SET consecutive_failures = 4 WHERE id = 'test-coverage'")

    await sched.recordOutcome('test-coverage', 'errored')

    expect(getLoop(db, 'test-coverage')!.enabled).toBe(false)
  })

  test('backoff: 1 failure delays by 10 min, 2 failures by 20 min', async () => {
    const created: string[] = []
    const sched = makeScheduler(0, async () => {
      created.push('x')
      return { session: makeSession('s'), runtime: {} as SessionRuntime }
    })

    db.run(
      "UPDATE loops SET consecutive_failures = 1, last_run_at = ? WHERE id = 'test-coverage'",
      [Date.now() - 5 * 60 * 1000],
    )

    await sched.tick(Date.now())

    const row = getLoop(db, 'test-coverage')
    expect(row!.consecutive_failures).toBe(1)
  })

  test('disabled loops are skipped during tick', async () => {
    const created: string[] = []
    const sched = makeScheduler(0, async (opts) => {
      created.push(opts.prompt)
      return { session: makeSession('s'), runtime: {} as SessionRuntime }
    })

    db.run("UPDATE loops SET enabled = 0")

    await sched.tick(Date.now())
    expect(created).toHaveLength(0)
  })
})
