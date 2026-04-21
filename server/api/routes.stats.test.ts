import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function makeApp(db: Database): Hono {
  const app = new Hono()
  const registry = createSessionRegistry({ getDb: () => db, spawnFn: () => {
    let resolveExit!: (code: number) => void
    const exitedPromise = new Promise<number>((r) => { resolveExit = r })
    let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
    let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>
    let closed = false
    function closeAll(code: number): void {
      if (closed) return
      closed = true
      try { stderrCtrl.close() } catch { /* ok */ }
      try { stdoutCtrl.close() } catch { /* ok */ }
      resolveExit(code)
    }
    const proc = {
      pid: 1, killed: false,
      stdin: { async write() {}, flush() {} },
      stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
      stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
      exited: exitedPromise,
      kill() { this.killed = true; closeAll(0) },
    }
    void Promise.resolve().then(() => { closeAll(0) })
    return proc
  }})
  registerApiRoutes(app, registry, () => db)
  return app
}

function seedStats(db: Database): void {
  const now = Date.now()
  db.run(
    `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s1', 'slug-1', null, 'task', 'completed', 60000, 1500, now - 1000],
  )
  db.run(
    `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s2', 'slug-2', null, 'plan', 'failed', 30000, 500, now - 2000],
  )
}

let testDb: Database
let originalToken: string | undefined

beforeEach(() => {
  originalToken = process.env['MINION_API_TOKEN']
  delete process.env['MINION_API_TOKEN']
  testDb = setupTestDb()
  resetEventBus()
})

afterEach(() => {
  if (originalToken !== undefined) {
    process.env['MINION_API_TOKEN'] = originalToken
  } else {
    delete process.env['MINION_API_TOKEN']
  }
  testDb.close()
  resetEventBus()
})

describe('GET /api/stats', () => {
  test('returns stats structure with empty db', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Record<string, unknown> }
    expect(body.data).toBeDefined()
    expect(typeof body.data['totalSessions']).toBe('number')
    expect(typeof body.data['totalTokens']).toBe('number')
    expect(body.data['bySessionState']).toBeDefined()
    expect(body.data['byMode']).toBeDefined()
    expect(typeof body.data['periodStart']).toBe('number')
    expect(typeof body.data['periodEnd']).toBe('number')
  })

  test('returns aggregated counts when stats rows exist', async () => {
    seedStats(testDb)
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { totalSessions: number; totalTokens: number; byMode: Record<string, number> } }
    expect(body.data.totalSessions).toBe(2)
    expect(body.data.totalTokens).toBe(2000)
    expect(body.data.byMode['task']).toBe(1)
    expect(body.data.byMode['plan']).toBe(1)
  })

  test('accepts days query param', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats?days=7'))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/stats/modes', () => {
  test('returns byMode breakdown', async () => {
    seedStats(testDb)
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats/modes'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { byMode: Record<string, number> } }
    expect(body.data.byMode['task']).toBe(1)
    expect(body.data.byMode['plan']).toBe(1)
  })
})

describe('GET /api/stats/recent', () => {
  test('returns up to 50 recent sessions', async () => {
    seedStats(testDb)
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats/recent'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { sessions: unknown[] } }
    expect(Array.isArray(body.data.sessions)).toBe(true)
    expect(body.data.sessions.length).toBe(2)
  })

  test('returns empty array when no stats', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/stats/recent'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { sessions: unknown[] } }
    expect(body.data.sessions).toEqual([])
  })
})
