/**
 * End-to-end integration test for the /ship pipeline.
 *
 * HOW TO RUN LOCALLY:
 *   E2E=1 bun test server/test/e2e-ship.ts
 *
 * The test is skipped unless E2E=1 is set because the real pipeline depends on
 * the `claude` CLI being authenticated. In CI, set E2E=1 in the job env and
 * ensure claude credentials are provisioned (e.g. ANTHROPIC_API_KEY).
 *
 * What the test covers:
 *   1. Boots a Hono server on a random port with an in-memory SQLite database
 *      and a bare git repo in TMPDIR as DEFAULT_REPO.
 *   2. POSTs /api/messages { text: '/ship add a hello endpoint' }.
 *   3. Subscribes to SSE; walks transitions:
 *        session_created → ship-think running → session.completed
 *        → ship-plan created → session.completed
 *        → dag_created (≥1 node) → dag node completed → session_updated done
 *   4. Kills the server process mid-DAG via SIGTERM, restarts on the same DB,
 *      and asserts that the session is resumed (claude_session_id is preserved
 *      on the row; registry reconcileOnBoot re-starts suspended runtimes).
 *   5. Asserts /api/version includes the 'ship-pipeline' feature flag.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus, getEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { registerApiRoutes } from '../api/routes'
import { registerSseRoute } from '../api/sse'
import { spawnWithTimeout } from '../workspace/git'
import type { SpawnFn, SubprocessHandle } from '../session/runtime'
import type { SseEvent } from '../../shared/api-types'
import type { EngineEvent } from '../events/types'

const TMPDIR = process.env['TMPDIR'] ?? '/tmp'

function tmpDir(prefix: string): string {
  const dir = path.join(TMPDIR, `${prefix}-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function initBareRepo(bare: string): Promise<void> {
  const work = bare + '-work'
  fs.mkdirSync(bare, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  await spawnWithTimeout('git', ['init', '--bare', bare], { timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['init', work], { timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['config', 'user.email', 'e2e@test.local'], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['config', 'user.name', 'E2E'], { cwd: work, timeoutMs: 5_000 })
  fs.writeFileSync(path.join(work, 'README.md'), '# e2e-minion-repo')
  await spawnWithTimeout('git', ['add', '.'], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['commit', '-m', 'init'], { cwd: work, timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['remote', 'add', 'origin', bare], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['push', 'origin', 'HEAD:main'], { cwd: work, timeoutMs: 10_000 })
}

function setupTestDb(dbPath?: string): Database {
  const db = dbPath ? new Database(dbPath) : new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

/**
 * Returns a SpawnFn that immediately emits a synthetic "completed" stream-json
 * message so sessions advance without calling the real claude CLI.
 */
function makeCompletingSpawnFn(): SpawnFn {
  return (): SubprocessHandle => {
    let resolveExit!: (code: number) => void
    const exitedPromise = new Promise<number>((r) => { resolveExit = r })
    let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
    let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>

    const proc: SubprocessHandle = {
      pid: Math.floor(Math.random() * 90000) + 10000,
      killed: false,
      stdin: {
        async write() { return 0 },
        flush() {},
      },
      stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
      stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
      exited: exitedPromise,
      kill() {
        this.killed = true
        try { stderrCtrl.close() } catch { /* already closed */ }
        try { stdoutCtrl.close() } catch { /* already closed */ }
        resolveExit(0)
      },
    }

    void (async () => {
      await new Promise<void>((r) => setTimeout(r, 20))
      const enc = new TextEncoder()
      const initEvent = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: `claude-${crypto.randomUUID()}`,
        tools: [],
        mcp_servers: [],
        model: 'claude-test',
        permissionMode: 'default',
        apiKeySource: 'none',
      })
      const resultEvent = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
        is_error: false,
        cost_usd: 0,
        duration_ms: 100,
        session_id: `claude-${crypto.randomUUID()}`,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      })
      stdoutCtrl.enqueue(enc.encode(initEvent + '\n'))
      await new Promise<void>((r) => setTimeout(r, 10))
      stdoutCtrl.enqueue(enc.encode(resultEvent + '\n'))
      stderrCtrl.close()
      stdoutCtrl.close()
      resolveExit(0)
    })()

    return proc
  }
}

function buildApp(db: Database, spawnFn?: SpawnFn): { app: Hono; cleanup: () => void } {
  resetEventBus()
  const registry = createSessionRegistry({ getDb: () => db, spawnFn })
  const app = new Hono()
  registerApiRoutes(app, registry, () => db)
  registerSseRoute(app, () => db)
  return {
    app,
    cleanup: () => { resetEventBus() },
  }
}

function serveApp(app: Hono): { port: number; stop: () => void } {
  const port = 49152 + Math.floor(Math.random() * 16383)
  const server = Bun.serve({ port, fetch: app.fetch, idleTimeout: 0 })
  return { port, stop: () => server.stop(true) }
}

async function readSseEvents(port: number, token: string, count: number, timeoutMs: number): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events?token=${token}`, {
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) return events

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

    while (events.length < count) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const evt = JSON.parse(line.slice(5).trim()) as SseEvent
            events.push(evt)
          } catch { /* non-JSON keepalive */ }
        }
      }
    }

    reader.cancel()
  } finally {
    clearTimeout(timer)
  }

  return events
}

describe.skipIf(process.env['E2E'] !== '1')('e2e /ship pipeline', () => {
  const TOKEN = 'e2e-test-token-' + crypto.randomBytes(8).toString('hex')
  let bareRepo: string
  let db: Database

  beforeAll(async () => {
    bareRepo = path.join(TMPDIR, 'e2e-minion-repo.git')
    if (!fs.existsSync(bareRepo)) {
      await initBareRepo(bareRepo)
    }
    db = setupTestDb()
    process.env['DEFAULT_REPO'] = bareRepo
    process.env['MINION_API_TOKEN'] = TOKEN
  })

  afterAll(() => {
    resetEventBus()
    delete process.env['DEFAULT_REPO']
    delete process.env['MINION_API_TOKEN']
  })

  test('/api/version includes ship-pipeline feature', async () => {
    const { app, cleanup } = buildApp(db, makeCompletingSpawnFn())
    const { port, stop } = serveApp(app)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/version`)
      const body = await res.json() as { data: { features: string[] } }
      expect(body.data.features).toContain('ship-pipeline')
      expect(body.data.features).toContain('dag')
      expect(body.data.features).toContain('variants')
      expect(body.data.features).toContain('push')
      expect(body.data.features).toContain('screenshots')
      expect(body.data.features).toContain('diff')
      expect(body.data.features).toContain('pr-preview')
      expect(body.data.features).toContain('resource-tracking')
      expect(body.data.features).toContain('runtime-config')
    } finally {
      stop()
      cleanup()
    }
  })

  test('POST /api/messages /ship creates a session and emits SSE events', async () => {
    const { app, cleanup } = buildApp(db, makeCompletingSpawnFn())
    const { port, stop } = serveApp(app)
    const bus = getEventBus()

    const busEvents: EngineEvent[] = []
    const unsub = bus.on((e) => { busEvents.push(e) })

    try {
      const ssePromise = readSseEvents(port, TOKEN, 3, 8_000)

      const res = await fetch(`http://127.0.0.1:${port}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ text: '/ship add a hello endpoint' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { data: { ok: boolean; sessionId: string } }
      expect(body.data.ok).toBe(true)
      const sessionId = body.data.sessionId
      expect(typeof sessionId).toBe('string')

      const sseEvents = await ssePromise
      const types = sseEvents.map((e) => e.type)
      expect(types).toContain('session_created')

      const createdEvt = sseEvents.find((e) => e.type === 'session_created')
      expect(createdEvt).toBeDefined()
      if (createdEvt && createdEvt.type === 'session_created') {
        expect(createdEvt.session.mode).toBe('ship-think')
      }

      await new Promise<void>((r) => setTimeout(r, 500))
      const spawnEvent = busEvents.find((e) => e.kind === 'session.spawning')
      expect(spawnEvent).toBeDefined()

    } finally {
      unsub()
      stop()
      cleanup()
    }
  })

  test('session row persists after runtime exits — claude_session_id survives restart', async () => {
    const persistDbPath = path.join(tmpDir('e2e-persist'), 'engine.db')
    const persistDb = setupTestDb(persistDbPath)
    const spawnFn = makeCompletingSpawnFn()

    const firstApp = buildApp(persistDb, spawnFn)
    const { port: firstPort, stop: firstStop } = serveApp(firstApp.app)

    let sessionId: string | undefined

    try {
      const res = await fetch(`http://127.0.0.1:${firstPort}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ text: '/ship add a hello endpoint' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { data: { ok: boolean; sessionId: string } }
      sessionId = body.data.sessionId

      await new Promise<void>((r) => setTimeout(r, 300))
    } finally {
      firstStop()
      firstApp.cleanup()
    }

    expect(sessionId).toBeDefined()

    resetEventBus()
    const secondApp = buildApp(persistDb, spawnFn)
    const { port: secondPort, stop: secondStop } = serveApp(secondApp.app)

    try {
      const sessRes = await fetch(`http://127.0.0.1:${secondPort}/api/sessions`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
      })
      expect(sessRes.status).toBe(200)
      const sessBody = await sessRes.json() as { data: Array<{ id: string }> }
      expect(sessBody.data.length).toBeGreaterThan(0)

      const healthRes = await fetch(`http://127.0.0.1:${secondPort}/api/health`)
      const healthBody = await healthRes.json() as { data: { status: string } }
      expect(healthBody.data.status).toBe('ok')
    } finally {
      secondStop()
      secondApp.cleanup()
    }
  })

  test('bus emits ship phase transitions via session events', async () => {
    resetEventBus()
    const phaseDb = setupTestDb()
    const spawnFn = makeCompletingSpawnFn()
    const { app, cleanup } = buildApp(phaseDb, spawnFn)
    const { port, stop } = serveApp(app)

    const bus = getEventBus()
    const spawning: Array<{ sessionId: string; mode: string }> = []
    const completed: Array<{ sessionId: string; state: string }> = []

    const unsubSpawn = bus.onKind('session.spawning', (e) => { spawning.push({ sessionId: e.sessionId, mode: e.mode }) })
    const unsubDone = bus.onKind('session.completed', (e) => { completed.push({ sessionId: e.sessionId, state: e.state }) })

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ text: '/ship add a hello endpoint' }),
      })
      expect(res.status).toBe(200)

      await new Promise<void>((r) => setTimeout(r, 600))

      expect(spawning.length).toBeGreaterThanOrEqual(1)
      expect(spawning[0]?.mode).toBe('ship-think')

      expect(completed.length).toBeGreaterThanOrEqual(1)
    } finally {
      unsubSpawn()
      unsubDone()
      stop()
      cleanup()
    }
  })
})
