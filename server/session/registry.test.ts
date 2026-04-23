import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createSessionRegistry } from './registry'
import { resetEventBus, getEventBus } from '../events/bus'
import { runMigrations } from '../db/sqlite'
import { spawnWithTimeout } from '../workspace/git'
import type { SpawnFn, SubprocessHandle } from './runtime'

// ---------------------------------------------------------------------------
// Infrastructure helpers
// ---------------------------------------------------------------------------

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'

function makeTmpDir(prefix: string): string {
  const dir = path.join(TMPDIR, `${prefix}-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function initLocalBareRepo(bare: string, work: string): Promise<void> {
  fs.mkdirSync(bare, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  await spawnWithTimeout('git', ['init', '--bare', bare], { timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['init', work], { timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['config', 'user.email', 'test@example.com'], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['config', 'user.name', 'Test'], { cwd: work, timeoutMs: 5_000 })
  fs.writeFileSync(path.join(work, 'README.md'), 'hello')
  await spawnWithTimeout('git', ['add', '.'], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['commit', '-m', 'init'], { cwd: work, timeoutMs: 10_000 })
  await spawnWithTimeout('git', ['remote', 'add', 'origin', bare], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout('git', ['push', 'origin', 'HEAD:main'], { cwd: work, timeoutMs: 10_000 })
}

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// Fake spawn that exits immediately with code 0 — never calls claude
// ---------------------------------------------------------------------------

function makeNoopSpawnFn(exitCode = 0): SpawnFn {
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
      stdin: {
        async write() {},
        flush() {},
      },
      stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
      stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
      exited: exitedPromise,
      kill() {
        this.killed = true
        closeAll(exitCode)
      },
    }

    void Promise.resolve().then(() => { closeAll(exitCode) })

    return proc
  }
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let db: Database
const tmpDirs: string[] = []

function trackedDir(prefix: string): string {
  const dir = makeTmpDir(prefix)
  tmpDirs.push(dir)
  return dir
}

beforeEach(() => {
  db = setupTestDb()
  resetEventBus()
})

afterEach(() => {
  db.close()
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionRegistry', () => {
  describe('create', () => {
    test('inserts a row, returns an ApiSession with status running', async () => {
      const bare = trackedDir('bare-origin')
      const work = trackedDir('work-origin')
      const workspaceRoot = trackedDir('ws-root')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({
        getDb: () => db,
        spawnFn: makeNoopSpawnFn(),
      })

      const { session } = await registry.create({
        mode: 'task',
        prompt: 'do the thing',
        repo: bare,
        workspaceRoot,
      })

      expect(session.status).toBe('running')
      expect(session.command).toBe('do the thing')
      expect(session.mode).toBe('task')
      expect(session.id).toBeTruthy()
      expect(session.slug).toBeTruthy()
      expect(session.branch).toBe(`minion/${session.slug}`)

      const row = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get(session.id)
      expect(row?.status).toBe('running')
    }, 30_000)

    test('stores bare_dir in DB row', async () => {
      const bare = trackedDir('bare-bd')
      const work = trackedDir('work-bd')
      const workspaceRoot = trackedDir('ws-bd')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      const { session } = await registry.create({
        mode: 'task',
        prompt: 'hello',
        repo: bare,
        workspaceRoot,
      })

      const row = db.query<{ bare_dir: string | null }, [string]>('SELECT bare_dir FROM sessions WHERE id = ?').get(session.id)
      expect(row?.bare_dir).toBeTruthy()
      expect(row?.bare_dir).toContain('.repos')
    }, 30_000)
  })

  describe('list', () => {
    test('returns created sessions', async () => {
      const bare = trackedDir('bare-list')
      const work = trackedDir('work-list')
      const workspaceRoot = trackedDir('ws-list')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      expect(registry.list()).toHaveLength(0)

      await registry.create({ mode: 'task', prompt: 'task 1', repo: bare, workspaceRoot })
      await registry.create({ mode: 'task', prompt: 'task 2', repo: bare, workspaceRoot })

      const sessions = registry.list()
      expect(sessions).toHaveLength(2)
    }, 60_000)
  })

  describe('get / getBySlug', () => {
    test('get returns runtime by id', async () => {
      const bare = trackedDir('bare-get')
      const work = trackedDir('work-get')
      const workspaceRoot = trackedDir('ws-get')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'hi', repo: bare, workspaceRoot })

      expect(registry.get(session.id)).toBeDefined()
      expect(registry.get('nonexistent')).toBeUndefined()
    }, 30_000)

    test('getBySlug returns runtime by slug', async () => {
      const bare = trackedDir('bare-slug')
      const work = trackedDir('work-slug')
      const workspaceRoot = trackedDir('ws-slug')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'hi', repo: bare, workspaceRoot, slug: 'my-special-slug' })

      expect(registry.getBySlug('my-special-slug')).toBeDefined()
      expect(registry.getBySlug('nonexistent')).toBeUndefined()
      expect(session.slug).toBe('my-special-slug')
    }, 30_000)
  })

  describe('close', () => {
    test('removes workspace directory, runtime from map, and deletes the DB row', async () => {
      const bare = trackedDir('bare-close')
      const work = trackedDir('work-close')
      const workspaceRoot = trackedDir('ws-close')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'do work', repo: bare, workspaceRoot })

      const workDir = path.join(workspaceRoot, session.slug)
      expect(fs.existsSync(workDir)).toBe(true)
      expect(registry.get(session.id)).toBeDefined()

      await registry.close(session.id)

      expect(registry.get(session.id)).toBeUndefined()
      expect(fs.existsSync(workDir)).toBe(false)

      const row = db.query<{ id: string }, [string]>('SELECT id FROM sessions WHERE id = ?').get(session.id)
      expect(row).toBeNull()
    }, 30_000)

    test('emits session.deleted event', async () => {
      const bare = trackedDir('bare-close-evt')
      const work = trackedDir('work-close-evt')
      const workspaceRoot = trackedDir('ws-close-evt')
      await initLocalBareRepo(bare, work)

      const bus = getEventBus()
      const deleted: string[] = []
      bus.onKind('session.deleted', (e) => { deleted.push(e.sessionId) })

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'evt', repo: bare, workspaceRoot })

      await registry.close(session.id)

      expect(deleted).toContain(session.id)
    }, 30_000)
  })

  describe('reply', () => {
    test('throws when session does not exist', async () => {
      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      await expect(registry.reply('missing-id', 'hello')).rejects.toThrow('Session missing-id not found')
    })

    test('throws when session has no claude_session_id to resume from', async () => {
      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation)
         VALUES ('reply-no-claude', 'reply-no-claude-slug', 'running', 'task', 'task', null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]')`,
        [now, now],
      )

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      await expect(registry.reply('reply-no-claude', 'hello')).rejects.toThrow('has no claude_session_id to resume from')
    })

    test('resumes a dead session via --resume when runtime is missing', async () => {
      const bare = trackedDir('bare-reply-resume')
      const work = trackedDir('work-reply-resume')
      const workspaceRoot = trackedDir('ws-reply-resume')
      await initLocalBareRepo(bare, work)

      const repoName = path.basename(bare).replace(/\.git$/, '')
      const bareDir = path.join(workspaceRoot, '.repos', `${repoName}.git`)

      const handle = await import('../workspace/prepare').then((m) =>
        m.prepareWorkspace({ slug: 'reply-resume-slug', repoUrl: bare, workspaceRoot, bootstrap: false }),
      )

      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation)
         VALUES ('reply-resume', 'reply-resume-slug', 'running', 'original prompt', 'task', ?, ?, ?, null, null, null, 'claude-abc', ?, ?, ?, 0, '[]', '[]', '[]')`,
        [bare, handle.branch, bareDir, workspaceRoot, now, now],
      )

      let capturedArgs: string[] = []
      const capturingSpawn: SpawnFn = (argv, opts) => {
        capturedArgs = argv
        return makeNoopSpawnFn()(argv, opts)
      }

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: capturingSpawn })

      expect(registry.get('reply-resume')).toBeUndefined()

      const ok = await registry.reply('reply-resume', 'the new user reply')
      expect(ok).toBe(true)

      await new Promise<void>((r) => setTimeout(r, 200))

      expect(capturedArgs).toContain('--resume')
      const resumeIdx = capturedArgs.indexOf('--resume')
      expect(capturedArgs[resumeIdx + 1]).toBe('claude-abc')
    }, 60_000)

    test('throws when the session has no claude_session_id to resume from', async () => {
      const bare = trackedDir('bare-reply')
      const work = trackedDir('work-reply')
      const workspaceRoot = trackedDir('ws-reply')
      await initLocalBareRepo(bare, work)

      const noop = makeNoopSpawnFn()
      const registry = createSessionRegistry({ getDb: () => db, spawnFn: noop })
      const { session } = await registry.create({ mode: 'task', prompt: 'hi', repo: bare, workspaceRoot })

      await new Promise<void>((r) => setTimeout(r, 100))

      await expect(registry.reply(session.id, 'more work')).rejects.toThrow(/claude_session_id/)
    }, 30_000)
  })

  describe('snapshot', () => {
    test('returns ApiSession for existing id', async () => {
      const bare = trackedDir('bare-snap')
      const work = trackedDir('work-snap')
      const workspaceRoot = trackedDir('ws-snap')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'snap', repo: bare, workspaceRoot })

      const snap = registry.snapshot(session.id)
      expect(snap).toBeDefined()
      expect(snap?.id).toBe(session.id)
    }, 30_000)

    test('returns undefined for unknown id', async () => {
      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      expect(registry.snapshot('ghost')).toBeUndefined()
    })
  })

  describe('reconcileOnBoot', () => {
    test('marks running sessions failed and emits a session_interrupted status event', async () => {
      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation)
         VALUES ('recon-1', 'recon-slug-1', 'running', 'task', 'task', null, null, null, null, null, null, null, null, ?, ?, 0, '[]', '[]', '[]')`,
        [now, now],
      )

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      await registry.reconcileOnBoot()

      const row = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get('recon-1')
      expect(row?.status).toBe('failed')
      expect(registry.get('recon-1')).toBeUndefined()

      const events = db
        .query<{ type: string; payload: string }, [string]>(
          'SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY seq',
        )
        .all('recon-1')
      expect(events.map((e) => e.type)).toEqual(['status', 'turn_completed'])
      const statusPayload = JSON.parse(events[0]!.payload) as { kind: string; severity: string }
      expect(statusPayload.kind).toBe('session_interrupted')
      expect(statusPayload.severity).toBe('error')
    })

    test('does not resume sessions even when claude_session_id is present', async () => {
      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation)
         VALUES ('recon-2', 'recon-slug', 'running', 'resume task', 'task', null, null, null, null, null, null, 'claude-session-xyz', null, ?, ?, 0, '[]', '[]', '[]')`,
        [now, now],
      )

      let spawned = false
      const capturingSpawn: SpawnFn = (argv, opts) => {
        spawned = true
        return makeNoopSpawnFn()(argv, opts)
      }

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: capturingSpawn })
      await registry.reconcileOnBoot()

      await new Promise<void>((r) => setTimeout(r, 100))

      expect(spawned).toBe(false)
      const row = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get('recon-2')
      expect(row?.status).toBe('failed')
      expect(registry.get('recon-2')).toBeUndefined()
    })

    test('resumes ship coordinator with claude_session_id on boot', async () => {
      const bare = trackedDir('bare-ship-resume')
      const work = trackedDir('work-ship-resume')
      const workspaceRoot = trackedDir('ws-ship-resume')
      await initLocalBareRepo(bare, work)

      const repoName = path.basename(bare).replace(/\.git$/, '')
      const bareDir = path.join(workspaceRoot, '.repos', `${repoName}.git`)

      const handle = await import('../workspace/prepare').then((m) =>
        m.prepareWorkspace({ slug: 'ship-resume-slug', repoUrl: bare, workspaceRoot, bootstrap: false }),
      )

      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, stage)
         VALUES ('ship-coord', 'ship-resume-slug', 'running', 'ship the feature', 'ship', ?, ?, ?, null, null, null, 'claude-ship-123', ?, ?, ?, 0, '[]', '[]', '[]', 'dag')`,
        [bare, handle.branch, bareDir, workspaceRoot, now, now],
      )

      let capturedArgs: string[] = []
      const capturingSpawn: SpawnFn = (argv, opts) => {
        capturedArgs = argv
        return makeNoopSpawnFn()(argv, opts)
      }

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: capturingSpawn })

      // Check status before reconcile - should be 'running'
      const beforeRow = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get('ship-coord')
      expect(beforeRow?.status).toBe('running')

      await registry.reconcileOnBoot()

      // Should have spawned with --resume
      expect(capturedArgs).toContain('--resume')
      const resumeIdx = capturedArgs.indexOf('--resume')
      expect(capturedArgs[resumeIdx + 1]).toBe('claude-ship-123')

      // The noop spawn completes immediately, so the status will be 'completed'
      // What matters is that resumeRuntime was called and --resume flag was passed
      await new Promise<void>((r) => setTimeout(r, 200))

      // Status will be 'completed' after the noop process exits
      const afterRow = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get('ship-coord')
      expect(afterRow?.status).toBe('completed')
    }, 60_000)

    test('marks ship coordinator as failed if resume throws', async () => {
      const now = Date.now()
      db.run(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, stage)
         VALUES ('ship-fail', 'ship-fail-slug', 'running', 'ship task', 'ship', null, 'minion/ship-fail-slug', null, null, null, null, 'claude-fail', null, ?, ?, 0, '[]', '[]', '[]', 'plan')`,
        [now, now],
      )

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      await registry.reconcileOnBoot()

      // Missing workspace should cause resume to fail
      const row = db.query<{ status: string }, [string]>('SELECT status FROM sessions WHERE id = ?').get('ship-fail')
      expect(row?.status).toBe('failed')
      expect(registry.get('ship-fail')).toBeUndefined()
    })
  })

  describe('session.snapshot events', () => {
    test('emits session.snapshot when create transitions to running', async () => {
      const bare = trackedDir('bare-evt')
      const work = trackedDir('work-evt')
      const workspaceRoot = trackedDir('ws-evt')
      await initLocalBareRepo(bare, work)

      const bus = getEventBus()
      const snapshots: string[] = []
      bus.onKind('session.snapshot', (e) => { snapshots.push(e.session.id) })

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })
      const { session } = await registry.create({ mode: 'task', prompt: 'evt', repo: bare, workspaceRoot })

      expect(snapshots).toContain(session.id)
    }, 30_000)
  })

  describe('childIds and stage propagation', () => {
    test('populates childIds in ApiSession ordered by created_at', async () => {
      const bare = trackedDir('bare-children')
      const work = trackedDir('work-children')
      const workspaceRoot = trackedDir('ws-children')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      // Create coordinator session
      const { session: coordinator } = await registry.create({
        mode: 'ship',
        prompt: 'ship the feature',
        repo: bare,
        workspaceRoot,
      })

      // Sleep to ensure different created_at timestamps
      await new Promise((r) => setTimeout(r, 10))

      // Create children with explicit delays to ensure ordering
      const { session: child1 } = await registry.create({
        mode: 'dag-task',
        prompt: 'child 1',
        repo: bare,
        workspaceRoot,
        parentId: coordinator.id,
      })

      await new Promise((r) => setTimeout(r, 10))

      const { session: child2 } = await registry.create({
        mode: 'dag-task',
        prompt: 'child 2',
        repo: bare,
        workspaceRoot,
        parentId: coordinator.id,
      })

      await new Promise((r) => setTimeout(r, 10))

      const { session: child3 } = await registry.create({
        mode: 'dag-task',
        prompt: 'child 3',
        repo: bare,
        workspaceRoot,
        parentId: coordinator.id,
      })

      // Verify coordinator has children in order
      const snap = registry.snapshot(coordinator.id)
      expect(snap).toBeDefined()
      expect(snap!.childIds).toEqual([child1.id, child2.id, child3.id])
    }, 60_000)

    test('includes stage in ApiSession when mode is ship', async () => {
      const bare = trackedDir('bare-stage')
      const work = trackedDir('work-stage')
      const workspaceRoot = trackedDir('ws-stage')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      // Create ship session
      const { session } = await registry.create({
        mode: 'ship',
        prompt: 'ship it',
        repo: bare,
        workspaceRoot,
      })

      // Update stage in database
      db.run(
        'UPDATE sessions SET stage = ? WHERE id = ?',
        ['think', session.id],
      )

      const snap = registry.snapshot(session.id)
      expect(snap).toBeDefined()
      expect(snap!.mode).toBe('ship')
      expect(snap!.stage).toBe('think')
    }, 30_000)

    test('excludes stage when mode is not ship', async () => {
      const bare = trackedDir('bare-no-stage')
      const work = trackedDir('work-no-stage')
      const workspaceRoot = trackedDir('ws-no-stage')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      const { session } = await registry.create({
        mode: 'task',
        prompt: 'regular task',
        repo: bare,
        workspaceRoot,
      })

      const snap = registry.snapshot(session.id)
      expect(snap).toBeDefined()
      expect(snap!.mode).toBe('task')
      expect(snap!.stage).toBeUndefined()
    }, 30_000)

    test('excludes stage when mode is ship but stage is null', async () => {
      const bare = trackedDir('bare-null-stage')
      const work = trackedDir('work-null-stage')
      const workspaceRoot = trackedDir('ws-null-stage')
      await initLocalBareRepo(bare, work)

      const registry = createSessionRegistry({ getDb: () => db, spawnFn: makeNoopSpawnFn() })

      const { session } = await registry.create({
        mode: 'ship',
        prompt: 'ship without stage',
        repo: bare,
        workspaceRoot,
      })

      const snap = registry.snapshot(session.id)
      expect(snap).toBeDefined()
      expect(snap!.mode).toBe('ship')
      expect(snap!.stage).toBeUndefined()
    }, 30_000)
  })
})
