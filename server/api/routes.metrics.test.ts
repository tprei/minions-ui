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

describe('GET /api/metrics', () => {
  test('returns metrics structure', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Record<string, unknown> }
    expect(body.data).toBeDefined()
    expect(typeof body.data['processMemBytes']).toBe('number')
    expect(typeof body.data['processCpuPct']).toBe('number')
    expect(typeof body.data['dbSizeBytes']).toBe('number')
    expect(typeof body.data['activeSessions']).toBe('number')
    expect(typeof body.data['activeDags']).toBe('number')
    expect(typeof body.data['uptimeSec']).toBe('number')
  })

  test('processMemBytes is positive', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    const body = await res.json() as { data: { processMemBytes: number } }
    expect(body.data.processMemBytes).toBeGreaterThan(0)
  })

  test('uptimeSec is non-negative', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    const body = await res.json() as { data: { uptimeSec: number } }
    expect(body.data.uptimeSec).toBeGreaterThanOrEqual(0)
  })

  test('activeSessions is 0 with empty db', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    const body = await res.json() as { data: { activeSessions: number } }
    expect(body.data.activeSessions).toBe(0)
  })
})
