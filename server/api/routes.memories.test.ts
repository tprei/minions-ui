import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'
import type { SpawnFn, SubprocessHandle } from '../session/runtime'
import type { ApiResponse, CreateMemoryRequest, MemoryEntry, ReviewMemoryRequest, UpdateMemoryRequest } from '../../shared/api-types'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

function makeNoopSpawnFn(): SpawnFn {
  return (): SubprocessHandle => {
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
      stdin: { async write() {}, flush() {} },
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
}

function makeApp(db: Database): Hono {
  const app = new Hono()
  const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
  registerApiRoutes(app, registry, () => db)
  return app
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
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

describe('POST /api/memories', () => {
  test('creates a memory with required fields', async () => {
    const app = makeApp(testDb)
    const body: CreateMemoryRequest = {
      kind: 'user',
      title: 'User prefers TypeScript',
      body: 'The user has indicated a strong preference for TypeScript over JavaScript.',
    }
    const res = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(res.status).toBe(201)
    const result = await json<ApiResponse<MemoryEntry>>(res)
    expect(result.data).toBeDefined()
    expect(result.data.kind).toBe('user')
    expect(result.data.title).toBe('User prefers TypeScript')
    expect(result.data.status).toBe('pending')
    expect(result.data.id).toBeGreaterThan(0)
  })

  test('creates a memory with all optional fields', async () => {
    const app = makeApp(testDb)
    const body: CreateMemoryRequest = {
      repo: 'https://github.com/test/repo',
      kind: 'feedback',
      title: 'Avoid mocking database',
      body: 'User prefers integration tests with real database.\n\n**Why:** Previous mock divergence caused production failures.\n\n**How to apply:** Use real DB for all integration tests.',
      pinned: true,
    }
    const res = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(res.status).toBe(201)
    const result = await json<ApiResponse<MemoryEntry>>(res)
    expect(result.data.repo).toBe('https://github.com/test/repo')
    expect(result.data.pinned).toBe(true)
  })

  test('rejects memory with missing required fields', async () => {
    const app = makeApp(testDb)
    const body = { kind: 'user' }
    const res = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/memories', () => {
  test('returns empty list when no memories exist', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/memories'))
    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ memories: MemoryEntry[]; pendingCount: number }>>(res)
    expect(result.data.memories).toEqual([])
    expect(result.data.pendingCount).toBe(0)
  })

  test('returns all memories', async () => {
    const app = makeApp(testDb)

    const mem1: CreateMemoryRequest = { kind: 'user', title: 'Memory 1', body: 'Body 1' }
    const mem2: CreateMemoryRequest = { kind: 'feedback', title: 'Memory 2', body: 'Body 2' }

    await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mem1),
    }))
    await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mem2),
    }))

    const res = await app.fetch(new Request('http://localhost/api/memories'))
    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ memories: MemoryEntry[]; pendingCount: number }>>(res)
    expect(result.data.memories).toHaveLength(2)
    expect(result.data.pendingCount).toBe(2)
  })

  test('filters memories by status', async () => {
    const app = makeApp(testDb)

    const mem1: CreateMemoryRequest = { kind: 'user', title: 'Memory 1', body: 'Body 1' }
    await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mem1),
    }))

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Memory 2', body: 'Body 2' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' } satisfies ReviewMemoryRequest),
    }))

    const res = await app.fetch(new Request('http://localhost/api/memories?status=approved'))
    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ memories: MemoryEntry[]; pendingCount: number }>>(res)
    expect(result.data.memories).toHaveLength(1)
    expect(result.data.memories[0]?.status).toBe('approved')
    expect(result.data.pendingCount).toBe(1)
  })

  test('searches memories using FTS', async () => {
    const app = makeApp(testDb)

    await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'TypeScript preference', body: 'User loves TypeScript' }),
    }))
    await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'feedback', title: 'Python linting', body: 'Use ruff for Python linting' }),
    }))

    const res = await app.fetch(new Request('http://localhost/api/memories?q=TypeScript'))
    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ memories: MemoryEntry[]; pendingCount: number }>>(res)
    expect(result.data.memories).toHaveLength(1)
    expect(result.data.memories[0]?.title).toContain('TypeScript')
  })
})

describe('PATCH /api/memories/:id', () => {
  test('updates memory title and body', async () => {
    const app = makeApp(testDb)

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Original', body: 'Original body' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    const update: UpdateMemoryRequest = { title: 'Updated', body: 'Updated body' }
    const res = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }))

    expect(res.status).toBe(200)
    const result = await json<ApiResponse<MemoryEntry>>(res)
    expect(result.data.title).toBe('Updated')
    expect(result.data.body).toBe('Updated body')
  })

  test('returns 404 for non-existent memory', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/memories/9999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    }))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/memories/:id/review', () => {
  test('approves a pending memory', async () => {
    const app = makeApp(testDb)

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Test', body: 'Test body' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    const review: ReviewMemoryRequest = { status: 'approved' }
    const res = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    }))

    expect(res.status).toBe(200)
    const result = await json<ApiResponse<MemoryEntry>>(res)
    expect(result.data.status).toBe('approved')
    expect(result.data.reviewedAt).toBeGreaterThan(0)
  })

  test('rejects a pending memory', async () => {
    const app = makeApp(testDb)

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Test', body: 'Test body' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    const review: ReviewMemoryRequest = { status: 'rejected' }
    const res = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    }))

    expect(res.status).toBe(200)
    const result = await json<ApiResponse<MemoryEntry>>(res)
    expect(result.data.status).toBe('rejected')
  })

  test('deletes memory when approving pending_deletion', async () => {
    const app = makeApp(testDb)

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Test', body: 'Test body' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending_deletion' }),
    }))

    const review: ReviewMemoryRequest = { status: 'approved' }
    const res = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    }))

    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ deleted: true }>>(res)
    expect(result.data.deleted).toBe(true)
  })
})

describe('DELETE /api/memories/:id', () => {
  test('deletes a memory', async () => {
    const app = makeApp(testDb)

    const createRes = await app.fetch(new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'user', title: 'Test', body: 'Test body' }),
    }))
    const created = await json<ApiResponse<MemoryEntry>>(createRes)

    const res = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}`, {
      method: 'DELETE',
    }))

    expect(res.status).toBe(200)
    const result = await json<ApiResponse<{ deleted: true }>>(res)
    expect(result.data.deleted).toBe(true)

    const getRes = await app.fetch(new Request(`http://localhost/api/memories/${created.data.id}`))
    expect(getRes.status).toBe(404)
  })

  test('returns 404 for non-existent memory', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/memories/9999', {
      method: 'DELETE',
    }))
    expect(res.status).toBe(404)
  })
})
