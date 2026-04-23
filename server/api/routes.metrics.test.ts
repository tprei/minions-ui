import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'
import type { ResourceSnapshot } from '../../shared/api-types'

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
  test('returns a ResourceSnapshot structure', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: ResourceSnapshot }
    expect(body.data).toBeDefined()
    expect(typeof body.data.ts).toBe('number')
    expect(typeof body.data.cpu.usagePercent).toBe('number')
    expect(typeof body.data.cpu.cpuCount).toBe('number')
    expect(typeof body.data.memory.usedBytes).toBe('number')
    expect(typeof body.data.memory.limitBytes).toBe('number')
    expect(typeof body.data.memory.rssBytes).toBe('number')
    expect(typeof body.data.disk.path).toBe('string')
    expect(typeof body.data.eventLoopLagMs).toBe('number')
    expect(typeof body.data.counts.activeSessions).toBe('number')
  })

  test('memory rssBytes is positive', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/metrics'))
    const body = await res.json() as { data: ResourceSnapshot }
    expect(body.data.memory.rssBytes).toBeGreaterThan(0)
  })
})
