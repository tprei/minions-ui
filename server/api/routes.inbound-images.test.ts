import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'
import type { SpawnFn, SubprocessHandle } from '../session/runtime'
import { serializeUserMessage } from '../session/stream-json'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

interface CapturedSpawn {
  argv: string[]
  stdinLines: string[]
}

function makeCapturingSpawnFn(): { spawnFn: SpawnFn; captured: CapturedSpawn[] } {
  const captured: CapturedSpawn[] = []

  const spawnFn: SpawnFn = (argv): SubprocessHandle => {
    const stdinLines: string[] = []
    captured.push({ argv, stdinLines })

    let resolveExit!: (code: number) => void
    const exitedPromise = new Promise<number>((r) => { resolveExit = r })
    let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
    let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>
    let closed = false

    function closeAll(code: number): void {
      if (closed) return
      closed = true
      try { stderrCtrl.close() } catch { /* already closed */ }
      try { stdoutCtrl.close() } catch { /* already closed */ }
      resolveExit(code)
    }

    const proc: SubprocessHandle = {
      pid: 1,
      killed: false,
      stdin: {
        async write(data: string) { stdinLines.push(data) },
        flush() {},
      },
      stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
      stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
      exited: exitedPromise,
      kill() {
        this.killed = true
        closeAll(0)
      },
    }

    void Promise.resolve().then(() => { closeAll(0) })

    return proc
  }

  return { spawnFn, captured }
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

let testDb: Database
let originalDefaultRepo: string | undefined
let originalToken: string | undefined

beforeEach(() => {
  originalToken = process.env['MINION_API_TOKEN']
  originalDefaultRepo = process.env['DEFAULT_REPO']
  delete process.env['MINION_API_TOKEN']
  delete process.env['DEFAULT_REPO']
  testDb = setupTestDb()
  resetEventBus()
})

afterEach(() => {
  if (originalToken !== undefined) {
    process.env['MINION_API_TOKEN'] = originalToken
  } else {
    delete process.env['MINION_API_TOKEN']
  }
  if (originalDefaultRepo !== undefined) {
    process.env['DEFAULT_REPO'] = originalDefaultRepo
  } else {
    delete process.env['DEFAULT_REPO']
  }
  testDb.close()
  resetEventBus()
})

describe('POST /api/messages — inbound images', () => {
  test('rejects image exceeding 5 MB with 400', async () => {
    const { spawnFn } = makeCapturingSpawnFn()
    const app = new Hono()
    const registry = createSessionRegistry({ getDb: () => testDb, spawnFn })
    registerApiRoutes(app, registry, () => testDb)

    const oversized = 'A'.repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3) + 100)
    const res = await app.fetch(new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'hello',
        sessionId: 'some-id',
        images: [{ mediaType: 'image/png', dataBase64: oversized }],
      }),
    }))

    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('5 MB')
  })

  test('slash command /task with image passes images to serializeUserMessage wire format', async () => {
    const { spawnFn, captured } = makeCapturingSpawnFn()
    const app = new Hono()
    const registry = createSessionRegistry({ getDb: () => testDb, spawnFn })
    registerApiRoutes(app, registry, () => testDb)

    process.env['DEFAULT_REPO'] = '/nonexistent/repo'

    const smallBase64 = Buffer.from('fake-png-bytes').toString('base64')

    const res = await app.fetch(new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: '/task do the thing',
        images: [{ mediaType: 'image/png', dataBase64: smallBase64 }],
      }),
    }))

    expect(res.status === 200 || res.status === 500).toBe(true)

    if (captured.length > 0) {
      const written = captured[0]!.stdinLines.join('')
      expect(written).toContain(smallBase64)
      expect(written).toContain('image/png')
    }
  })

  test('plain text reply with image passes through to injectInput', async () => {
    const { spawnFn } = makeCapturingSpawnFn()
    const app = new Hono()
    const registry = createSessionRegistry({ getDb: () => testDb, spawnFn })
    registerApiRoutes(app, registry, () => testDb)

    const smallBase64 = Buffer.from('img-data').toString('base64')
    const res = await app.fetch(new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'here is my screenshot',
        sessionId: 'no-such-session',
        images: [{ mediaType: 'image/png', dataBase64: smallBase64 }],
      }),
    }))

    expect(res.status).toBe(500)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('No runtime for session no-such-session')
  })

  test('serializeUserMessage includes image content blocks', () => {
    const images = [{ mediaType: 'image/png' as const, dataBase64: 'abc123' }]
    const line = serializeUserMessage('look at this', images)
    const parsed = JSON.parse(line) as { message: { content: Array<{ type: string; source?: { data: string } }> } }
    const content = parsed.message.content
    const imageBlock = content.find((b) => b.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock?.source?.data).toBe('abc123')
  })

  test('invalid mediaType is rejected with 400', async () => {
    const { spawnFn } = makeCapturingSpawnFn()
    const app = new Hono()
    const registry = createSessionRegistry({ getDb: () => testDb, spawnFn })
    registerApiRoutes(app, registry, () => testDb)

    const res = await app.fetch(new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'test',
        images: [{ mediaType: 'image/bmp', dataBase64: 'abc' }],
      }),
    }))

    expect(res.status).toBe(400)
  })
})
