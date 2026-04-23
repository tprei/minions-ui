import { test, expect, beforeEach, afterEach, describe } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { getEventBus, resetEventBus } from '../events/bus'
import { registerSseRoute } from './sse'
import { bearerAuth } from './auth'
import { runMigrations } from '../db/sqlite'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

function insertSession(db: Database, id: string, status = 'running'): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
     VALUES (?, ?, ?, 'run something', 'task', null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0, null, null)`,
    [id, `${id}-slug`, status, now, now],
  )
}

function makeApp(db: Database): Hono {
  const app = new Hono()
  app.use('/api/events', bearerAuth())
  registerSseRoute(app, () => db)
  return app
}

class SseReader {
  private chunks: string[] = []
  private buffer = ''
  private decoder = new TextDecoder()
  private reader: ReadableStreamDefaultReader<Uint8Array>

  constructor(res: Response) {
    this.reader = new ReadableStreamDefaultReader<Uint8Array>(res.body as ReadableStream<Uint8Array>)
    void this.pump()
  }

  private async pump(): Promise<void> {
    try {
      while (true) {
        const result = await this.reader.read()
        if (result.done) break
        const raw: Uint8Array = result.value as Uint8Array
        const text = this.decoder.decode(raw, { stream: true })
        this.buffer += text
        const parts = this.buffer.split('\n\n')
        this.buffer = parts.pop() ?? ''
        for (const block of parts) {
          this.chunks.push(block)
        }
      }
    } catch {
      // stream cancelled or closed
    }
  }

  async read(count: number, timeoutMs = 3000): Promise<Array<{ event: string; data: string }>> {
    const collected: Array<{ event: string; data: string }> = []
    const deadline = Date.now() + timeoutMs

    while (collected.length < count && Date.now() < deadline) {
      const block = this.chunks.shift()
      if (block !== undefined) {
        const parsed = parseSseBlock(block)
        if (parsed) collected.push(parsed)
      } else {
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    return collected
  }

  cancel(): void {
    this.reader.cancel()
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data = line.slice(5).trim()
  }
  if (data === '' && event === 'message') return null
  return { event, data }
}

let originalToken: string | undefined
let testDb: Database

beforeEach(() => {
  originalToken = process.env['MINION_API_TOKEN']
  delete process.env['MINION_API_TOKEN']
  resetEventBus()
  testDb = setupTestDb()
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

describe('auth middleware', () => {
  test('no token set — connection accepted', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/events'))
    expect(res.status).toBe(200)
    res.body?.cancel()
  })

  test('token set + correct Authorization header — connection accepted', async () => {
    process.env['MINION_API_TOKEN'] = 'secret123'
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/events', {
        headers: { authorization: 'Bearer secret123' },
      }),
    )
    expect(res.status).toBe(200)
    res.body?.cancel()
  })

  test('token set + correct ?token= query — connection accepted', async () => {
    process.env['MINION_API_TOKEN'] = 'secret123'
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/events?token=secret123'))
    expect(res.status).toBe(200)
    res.body?.cancel()
  })

  test('token set + wrong token — 401', async () => {
    process.env['MINION_API_TOKEN'] = 'secret123'
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/events', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('snapshot on connect', () => {
  test('emits session_created for a session in db', async () => {
    insertSession(testDb, 'sess-snap')
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/events'))
    expect(res.status).toBe(200)

    const reader = new SseReader(res)
    const events = await reader.read(1)
    reader.cancel()

    expect(events.length).toBe(1)
    const parsed = JSON.parse(events[0]!.data) as { type: string; session: { id: string } }
    expect(parsed.type).toBe('session_created')
    expect(parsed.session.id).toBe('sess-snap')
  })
})

describe('live event projection', () => {
  test('session.snapshot emits session_created on first bus emit', async () => {
    const app = makeApp(testDb)
    const bus = getEventBus()
    const res = await app.fetch(new Request('http://localhost/api/events'))
    expect(res.status).toBe(200)

    const reader = new SseReader(res)
    const now = Date.now()
    const session = {
      id: 'sess-live',
      slug: 'live-slug',
      status: 'running' as const,
      command: 'do something',
      mode: 'task',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      conversation: [],
    }

    const collectPromise = reader.read(1)
    bus.emit({ kind: 'session.snapshot', session })
    const events = await collectPromise
    reader.cancel()

    expect(events.length).toBe(1)
    const parsed = JSON.parse(events[0]!.data) as { type: string; session: { id: string } }
    expect(parsed.type).toBe('session_created')
    expect(parsed.session.id).toBe('sess-live')
  })

  test('second session.snapshot for same id emits session_updated', async () => {
    const app = makeApp(testDb)
    const bus = getEventBus()
    const res = await app.fetch(new Request('http://localhost/api/events'))
    expect(res.status).toBe(200)

    const reader = new SseReader(res)
    const now = Date.now()
    const session = {
      id: 'sess-update',
      slug: 'update-slug',
      status: 'running' as const,
      command: 'do something',
      mode: 'task',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      conversation: [],
    }

    const firstCollect = reader.read(1)
    bus.emit({ kind: 'session.snapshot', session })
    const first = await firstCollect
    expect(JSON.parse(first[0]!.data)).toMatchObject({ type: 'session_created' })

    const secondCollect = reader.read(1)
    bus.emit({ kind: 'session.snapshot', session: { ...session, status: 'completed' } })
    const second = await secondCollect
    reader.cancel()

    expect(second.length).toBe(1)
    expect(JSON.parse(second[0]!.data)).toMatchObject({ type: 'session_updated' })
  })
})
