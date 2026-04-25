import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { prepared, runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'
import { registerSseRoute } from './sse'
import type { SpawnFn, SubprocessHandle } from '../session/runtime'

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
  registerSseRoute(app, () => db)
  return app
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

let testDb: Database
let originalToken: string | undefined
let originalDefaultRepo: string | undefined

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

describe('GET /api/version', () => {
  test('returns apiVersion, libraryVersion, and required features', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/version'))
    expect(res.status).toBe(200)
    const body = await json<{ data: { apiVersion: string; libraryVersion: string; features: string[]; provider: string } }>(res)
    expect(body.data.apiVersion).toBeTruthy()
    expect(body.data.libraryVersion).toBeTruthy()
    const features = body.data.features
    expect(features).toContain('sessions-create')
    expect(features).toContain('messages')
    expect(features).toContain('sessions-create-images')
    expect(features).toContain('sessions-variants')
    expect(features).toContain('ship-coordinator')
    expect(features).toContain('web-push')
    expect(features).toContain('transcript')
    expect(features).toContain('auth')
    expect(features).toContain('cors-allowlist')
    expect(body.data.provider).toBe('claude')
  })
})

describe('GET /api/sessions', () => {
  test('empty returns { data: [] }', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions'))
    expect(res.status).toBe(200)
    const body = await json<{ data: unknown[] }>(res)
    expect(body.data).toEqual([])
  })
})

describe('POST /api/sessions', () => {
  test('missing repo returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do the thing', mode: 'task' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('missing prompt returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'task', repo: '/some/repo' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('invalid mode returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do it', mode: 'nope', repo: '/repo' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('old ship-think mode returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do it', mode: 'ship-think', repo: '/repo' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('old ship-plan mode returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do it', mode: 'ship-plan', repo: '/repo' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('old ship-verify mode returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do it', mode: 'ship-verify', repo: '/repo' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('valid body with unreachable repo returns 500', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do the thing', mode: 'task', repo: '/nonexistent/repo/path' }),
      }),
    )
    expect(res.status).toBe(500)
  })
})

describe('GET /api/sessions/:slug', () => {
  test('unknown slug returns 404', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/no-such-slug'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/commands', () => {
  test('stop with unknown sessionId returns 200 (idempotent)', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sessionId: 'no-such-session' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ data: { success: boolean } }>(res)
    expect(body.data.success).toBe(true)
  })

  test('plan_action returns success:false with error message', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'plan_action', sessionId: 'some-id', planAction: 'execute' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ data: { success: boolean; error: string } }>(res)
    expect(body.data.success).toBe(false)
    expect(body.data.error).toBeTruthy()
  })

  test('ship_advance command is accepted', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ship_advance', sessionId: 'some-id', to: 'plan' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('ship_advance command without "to" is accepted', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ship_advance', sessionId: 'some-id' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('ship_advance advances ship stage when scheduler is configured', async () => {
    const app = new Hono()
    const registry = createSessionRegistry({ getDb: () => testDb, spawnFn: makeNoopSpawnFn() })
    registerApiRoutes(app, registry, () => testDb, { start: async () => {} })
    const now = Date.now()
    testDb.run(
      `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage)
       VALUES ('ship-route-1', 'ship-route-1', 'running', 'ship it', 'ship', null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0, 'plan')`,
      [now, now],
    )
    prepared.insertEvent(testDb, {
      session_id: 'ship-route-1',
      seq: 1,
      turn: 1,
      type: 'assistant_text',
      timestamp: now,
      payload: {
        id: 'ship-route-plan',
        sessionId: 'ship-route-1',
        seq: 1,
        turn: 1,
        timestamp: now,
        type: 'assistant_text',
        blockId: 'plan',
        text: [
          '```json',
          '[',
          '  {',
          '    "id": "implement-route",',
          '    "title": "Implement route",',
          '    "description": "Implement the route.",',
          '    "dependsOn": []',
          '  }',
          ']',
          '```',
        ].join('\n'),
        final: true,
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ship_advance', sessionId: 'ship-route-1', to: 'dag' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await json<{ data: { success: boolean; error?: string; dagId?: string } }>(res)
    expect(body.data.success).toBe(true)
    expect(body.data.dagId).toBeDefined()
    const row = testDb.query<{ stage: string | null }, [string]>('SELECT stage FROM sessions WHERE id = ?').get('ship-route-1')
    expect(row?.stage).toBe('dag')
  })

  test('invalid body returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unknown_action', sessionId: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/messages', () => {
  test('/task without DEFAULT_REPO returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '/task do the thing' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('DEFAULT_REPO')
  })

  test('/task without prompt returns 400', async () => {
    process.env['DEFAULT_REPO'] = '/nonexistent/path/to/repo'
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '/task' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('requires a prompt')
  })

  test('/task with DEFAULT_REPO pointing to unreachable path returns 500', async () => {
    process.env['DEFAULT_REPO'] = '/nonexistent/path/to/repo'
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '/task do the thing' }),
      }),
    )
    expect(res.status).toBe(500)
  })

  test('plain text without sessionId returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello world' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('plain text with unknown sessionId returns 500', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello world', sessionId: 'no-such-session' }),
      }),
    )
    expect(res.status).toBe(500)
  })

  test('unknown slash command returns 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '/notacommand foo' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toBe('unknown command')
  })
})

describe('Deferred routes return 501', () => {
  test('GET /api/sessions/:slug/diff → 404 for unknown slug', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/anything/diff'))
    expect(res.status).toBe(404)
  })

  test('GET /api/sessions/:slug/screenshots → 404 for unknown slug', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/anything/screenshots'))
    expect(res.status).toBe(404)
  })

  test('GET /api/sessions/:slug/pr → 404 for unknown slug', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/anything/pr'))
    expect(res.status).toBe(404)
  })

  test('session-scoped routes accept either id or slug', async () => {
    const app = makeApp(testDb)
    const now = Date.now()
    testDb.run(
      `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
       VALUES ('sess-uuid-aaa', 'nice-slug-0001', 'running', 'hi', 'task', null, null, null, null, null, null, null, ${now}, ${now}, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    )

    const bySlug = await app.fetch(new Request('http://localhost/api/sessions/nice-slug-0001/transcript'))
    expect(bySlug.status).toBe(200)

    const byId = await app.fetch(new Request('http://localhost/api/sessions/sess-uuid-aaa/transcript'))
    expect(byId.status).toBe(200)

    const missing = await app.fetch(new Request('http://localhost/api/sessions/not-a-thing/transcript'))
    expect(missing.status).toBe(404)
  })

  test('POST /api/sessions/variants with no body → 400', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(
      new Request('http://localhost/api/sessions/variants', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })

  test('GET /api/push/vapid-public-key → not 501', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push/vapid-public-key'))
    expect(res.status).not.toBe(501)
  })
})

describe('GET /api/dags', () => {
  test('returns empty data array', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/dags'))
    expect(res.status).toBe(200)
    const body = await json<{ data: unknown[] }>(res)
    expect(body.data).toEqual([])
  })
})

describe('GET /api/dags/:id', () => {
  test('returns 404 for unknown dag', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/dags/some-dag-id'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/:slug/screenshots', () => {
  test('returns 404 for unknown session slug', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/no-such-session/screenshots'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/:slug/screenshots/:filename traversal guard', () => {
  test('rejects filenames with path separators', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/anything/screenshots/..%2Fetc%2Fpasswd'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sessions/variants', () => {
  test('returns 400 for missing required fields', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/variants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    }))
    expect(res.status).toBe(400)
  })

  test('returns 400 when count < 2', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/variants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', mode: 'task', count: 1 }),
    }))
    expect(res.status).toBe(400)
  })

  test('returns 400 when no repo and no DEFAULT_REPO', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/variants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', mode: 'task', count: 2 }),
    }))
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('repo')
  })
})

describe('GET /api/push/vapid-public-key', () => {
  test('returns 200 with a public key', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push/vapid-public-key'))
    expect(res.status).toBe(200)
    const body = await json<{ data: { key: string } }>(res)
    expect(body.data.key).toBeTruthy()
    expect(body.data.key.length).toBeGreaterThan(10)
  })
})

describe('POST /api/push-subscribe', () => {
  test('returns 400 for invalid body', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push-subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notAnEndpoint: true }),
    }))
    expect(res.status).toBe(400)
  })

  test('subscribes and returns ok with id', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push-subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/test-sub',
        expirationTime: null,
        keys: { p256dh: 'pk123', auth: 'ak123' },
      }),
    }))
    expect(res.status).toBe(200)
    const body = await json<{ data: { ok: boolean; id: string } }>(res)
    expect(body.data.ok).toBe(true)
    expect(body.data.id).toBeTruthy()
  })
})

describe('DELETE /api/push-subscribe', () => {
  test('unsubscribes silently', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push-subscribe', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/test-sub' }),
    }))
    expect(res.status).toBe(200)
    const body = await json<{ data: { ok: boolean } }>(res)
    expect(body.data.ok).toBe(true)
  })

  test('returns 400 for invalid body', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/push-subscribe', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
  })
})
