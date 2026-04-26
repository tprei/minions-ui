import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { createSessionRegistry } from '../session/registry'
import { resetEventBus } from '../events/bus'
import { prepared, runMigrations } from '../db/sqlite'
import { registerApiRoutes } from './routes'
import { registerSseRoute } from './sse'
import { runGit } from '../workspace/git'
import { createSessionCheckpoint } from '../checkpoints/session-checkpoints'
import type { SpawnFn, SubprocessHandle } from '../session/runtime'
import type { AuditEvent, ExternalTaskResult, MergeReadiness, QualityReport, ReadinessSummary, RestoreCheckpointResult, SessionCheckpoint } from '../../shared/api-types'

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

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
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
    expect(features).toContain('merge-readiness')
    expect(features).toContain('readiness-analytics')
    expect(features).toContain('session-checkpoints')
    expect(features).toContain('external-entrypoints')
    expect(features).toContain('audit-log')
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

describe('GET /api/readiness/summary', () => {
  test('aggregates sessions, PRs, quality reports, and checkpoints', async () => {
    const now = Date.now()
    prepared.insertSession(testDb, {
      id: 'summary-a',
      slug: 'summary-a',
      status: 'completed',
      command: 'cmd',
      mode: 'task',
      repo: 'repo-a',
      branch: null,
      bare_dir: null,
      pr_url: 'https://github.com/acme/widgets/pull/1',
      parent_id: null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: null,
      created_at: now,
      updated_at: now,
      needs_attention: false,
      attention_reasons: [],
      quick_actions: [],
      conversation: [],
      quota_sleep_until: null,
      quota_retry_count: 0,
      metadata: { qualityReport: { allPassed: true, results: [] } },
      pipeline_advancing: false,
      stage: null,
      coordinator_children: [],
    })
    prepared.insertSession(testDb, {
      id: 'summary-b',
      slug: 'summary-b',
      status: 'failed',
      command: 'cmd',
      mode: 'plan',
      repo: null,
      branch: null,
      bare_dir: null,
      pr_url: null,
      parent_id: null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: null,
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
    prepared.insertSessionCheckpoint(testDb, {
      id: 'cp-summary',
      session_id: 'summary-a',
      turn: 1,
      kind: 'completion',
      label: 'Session completed',
      sha: 'abc',
      base_sha: 'abc',
      branch: null,
      dag_id: null,
      dag_node_id: null,
      created_at: now,
    })

    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/readiness/summary'))
    expect(res.status).toBe(200)
    const body = await json<{ data: ReadinessSummary }>(res)
    expect(body.data.sessions.total).toBe(2)
    expect(body.data.pullRequests.withPr).toBe(1)
    expect(body.data.quality.passed).toBe(1)
    expect(body.data.quality.missing).toBe(1)
    expect(body.data.checkpoints.total).toBe(1)
  })
})

describe('GET /api/audit/events', () => {
  test('returns recent audit events with limit validation', async () => {
    const now = Date.now()
    prepared.insertAuditEvent(testDb, {
      id: 'audit-1',
      action: 'checkpoint.restored',
      session_id: null,
      target_type: 'session_checkpoint',
      target_id: 'cp-1',
      metadata: { turn: 2 },
      created_at: now,
    })
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/audit/events?limit=1'))
    expect(res.status).toBe(200)
    const body = await json<{ data: AuditEvent[] }>(res)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.action).toBe('checkpoint.restored')

    const invalid = await app.fetch(new Request('http://localhost/api/audit/events?limit=0'))
    expect(invalid.status).toBe(400)
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

describe('POST /api/entrypoints', () => {
  test('creates a source-linked session and returns the existing session on retry', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'entrypoint-api-'))
    const repo = path.join(root, 'repo')
    const workspaceRoot = path.join(root, 'workspaces')
    const previousWorkspaceRoot = process.env['WORKSPACE_ROOT']
    mkdirSync(repo, { recursive: true })

    try {
      process.env['WORKSPACE_ROOT'] = workspaceRoot
      await runGit(repo, ['init', '-b', 'main'])
      await runGit(repo, ['config', 'user.email', 'minions@example.test'])
      await runGit(repo, ['config', 'user.name', 'Minions Test'])
      writeFileSync(path.join(repo, 'README.txt'), 'base\n')
      await runGit(repo, ['add', 'README.txt'])
      await runGit(repo, ['commit', '-m', 'initial'])

      const app = makeApp(testDb)
      const body = {
        source: 'github_issue',
        externalId: 'acme/widgets#123',
        repo,
        prompt: 'Fix issue 123',
        title: 'Bug in widget flow',
        url: 'https://github.com/acme/widgets/issues/123',
        author: 'octocat',
      }

      const first = await app.fetch(new Request('http://localhost/api/entrypoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
      expect(first.status).toBe(201)
      const firstBody = await json<{ data: ExternalTaskResult }>(first)
      expect(firstBody.data.existing).toBe(false)
      expect(firstBody.data.task.source).toBe('github_issue')

      const row = prepared.getSession(testDb, firstBody.data.session.id)
      expect(row?.metadata.entrypoint).toMatchObject({
        source: 'github_issue',
        externalId: 'acme/widgets#123',
        title: 'Bug in widget flow',
      })
      await waitForCondition(() =>
        prepared.listSessionCheckpoints(testDb, firstBody.data.session.id).some((checkpoint) => checkpoint.kind === 'completion'),
      )
      const audit = prepared.listAuditEvents(testDb)
      expect(audit.some((event) => event.action === 'external_task.started' && event.session_id === firstBody.data.session.id)).toBe(true)

      const second = await app.fetch(new Request('http://localhost/api/entrypoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
      expect(second.status).toBe(200)
      const secondBody = await json<{ data: ExternalTaskResult }>(second)
      expect(secondBody.data.existing).toBe(true)
      expect(secondBody.data.session.id).toBe(firstBody.data.session.id)
    } finally {
      if (previousWorkspaceRoot !== undefined) {
        process.env['WORKSPACE_ROOT'] = previousWorkspaceRoot
      } else {
        delete process.env['WORKSPACE_ROOT']
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('requires a repo when DEFAULT_REPO is unset', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/entrypoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'slack_thread',
        externalId: 'C1:123.45',
        prompt: 'Investigate the alert',
      }),
    }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/sessions/:slug', () => {
  test('unknown slug returns 404', async () => {
    const app = makeApp(testDb)
    const res = await app.fetch(new Request('http://localhost/api/sessions/no-such-slug'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/:slug/readiness', () => {
  test('returns merge readiness for a completed session without a PR', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'readiness-api-'))
    const slug = 'readiness-slug'
    mkdirSync(path.join(root, slug))
    const now = Date.now()
    const report: QualityReport = { allPassed: true, results: [] }
    prepared.insertSession(testDb, {
      id: 'readiness-session',
      slug,
      status: 'completed',
      command: 'cmd',
      mode: 'task',
      repo: null,
      branch: null,
      bare_dir: null,
      pr_url: null,
      parent_id: null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: root,
      created_at: now,
      updated_at: now,
      needs_attention: false,
      attention_reasons: [],
      quick_actions: [],
      conversation: [],
      quota_sleep_until: null,
      quota_retry_count: 0,
      metadata: { qualityReport: report },
      pipeline_advancing: false,
      stage: null,
      coordinator_children: [],
    })

    const app = makeApp(testDb)
    const res = await app.fetch(new Request(`http://localhost/api/sessions/${slug}/readiness`))
    expect(res.status).toBe(200)
    const body = await json<{ data: MergeReadiness }>(res)
    expect(body.data.status).toBe('blocked')
    expect(body.data.checks.find((check) => check.id === 'pull-request')?.status).toBe('blocked')
    rmSync(root, { recursive: true, force: true })
  })
})

describe('session checkpoint routes', () => {
  test('lists checkpoints and restores a stopped session workspace', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'checkpoint-api-'))
    const slug = 'checkpoint-slug'
    const cwd = path.join(root, slug)
    mkdirSync(cwd, { recursive: true })

    try {
      await runGit(cwd, ['init', '-b', 'main'])
      await runGit(cwd, ['config', 'user.email', 'minions@example.test'])
      await runGit(cwd, ['config', 'user.name', 'Minions Test'])
      writeFileSync(path.join(cwd, 'tracked.txt'), 'base\n')
      await runGit(cwd, ['add', 'tracked.txt'])
      await runGit(cwd, ['commit', '-m', 'initial'])

      const now = Date.now()
      const row = {
        id: 'checkpoint-session',
        slug,
        status: 'completed' as const,
        command: 'cmd',
        mode: 'task',
        repo: cwd,
        branch: 'minion/checkpoint-slug',
        bare_dir: null,
        pr_url: null,
        parent_id: null,
        variant_group_id: null,
        claude_session_id: null,
        workspace_root: root,
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
      }
      prepared.insertSession(testDb, row)
      writeFileSync(path.join(cwd, 'tracked.txt'), 'checkpoint\n')
      const checkpoint = await createSessionCheckpoint({
        db: testDb,
        session: row,
        turn: 1,
        kind: 'turn',
        label: 'Turn 1',
      })
      writeFileSync(path.join(cwd, 'tracked.txt'), 'later\n')

      const app = makeApp(testDb)
      const listRes = await app.fetch(new Request(`http://localhost/api/sessions/${slug}/checkpoints`))
      expect(listRes.status).toBe(200)
      const listBody = await json<{ data: SessionCheckpoint[] }>(listRes)
      expect(listBody.data.map((item) => item.id)).toEqual([checkpoint.id])

      const restoreRes = await app.fetch(new Request(
        `http://localhost/api/sessions/${slug}/checkpoints/${checkpoint.id}/restore`,
        { method: 'POST' },
      ))
      expect(restoreRes.status).toBe(200)
      const restoreBody = await json<{ data: RestoreCheckpointResult }>(restoreRes)
      expect(restoreBody.data.checkpoint.id).toBe(checkpoint.id)
      expect(readFileSync(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('checkpoint\n')
      const events = prepared.listAuditEvents(testDb)
      expect(events[0]?.action).toBe('checkpoint.restored')
      expect(events[0]?.target_id).toBe(checkpoint.id)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
