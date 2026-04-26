import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepared, runMigrations, type SessionRow } from '../db/sqlite'
import { runGit } from '../workspace/git'
import { createSessionCheckpoint, restoreSessionCheckpoint } from './session-checkpoints'

let db: Database
let root: string
let cwd: string

function setupTestDb(): Database {
  const testDb = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  testDb.exec(schema)
  runMigrations(testDb)
  return testDb
}

async function initRepo(): Promise<void> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minions-checkpoints-'))
  cwd = path.join(root, 'session-slug')
  fs.mkdirSync(cwd, { recursive: true })
  await runGit(cwd, ['init', '-b', 'main'])
  await runGit(cwd, ['config', 'user.email', 'minions@example.test'])
  await runGit(cwd, ['config', 'user.name', 'Minions Test'])
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'base\n')
  await runGit(cwd, ['add', 'tracked.txt'])
  await runGit(cwd, ['commit', '-m', 'initial'])
}

function makeSession(metadata: Record<string, unknown> = {}): SessionRow {
  const now = Date.now()
  return {
    id: 'session-1',
    slug: 'session-slug',
    status: 'completed',
    command: 'do work',
    mode: 'task',
    repo: cwd,
    branch: 'minion/session-slug',
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
    metadata,
    pipeline_advancing: false,
    stage: null,
    coordinator_children: [],
  }
}

beforeEach(async () => {
  db = setupTestDb()
  await initRepo()
})

afterEach(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('session checkpoints', () => {
  test('captures tracked and untracked workspace files without moving HEAD', async () => {
    const session = makeSession({ dagId: 'dag-1', dagNodeId: 'node-a' })
    prepared.insertSession(db, session)
    const head = (await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()

    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'checkpoint\n')
    fs.writeFileSync(path.join(cwd, 'new.txt'), 'new file\n')

    const checkpoint = await createSessionCheckpoint({
      db,
      session,
      turn: 2,
      kind: 'turn',
      label: 'Turn 2',
    })

    expect(checkpoint.turn).toBe(2)
    expect(checkpoint.dagId).toBe('dag-1')
    expect(checkpoint.dagNodeId).toBe('node-a')
    expect(prepared.listSessionCheckpoints(db, session.id)).toHaveLength(1)
    expect((await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head)

    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'later\n')
    fs.rmSync(path.join(cwd, 'new.txt'), { force: true })

    const restored = await restoreSessionCheckpoint({
      db,
      session,
      checkpointId: checkpoint.id,
    })

    expect(restored.id).toBe(checkpoint.id)
    expect(fs.readFileSync(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('checkpoint\n')
    expect(fs.readFileSync(path.join(cwd, 'new.txt'), 'utf8')).toBe('new file\n')
    expect((await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head)

    const updated = prepared.getSession(db, session.id)
    expect(updated?.metadata.restoredCheckpointId).toBe(checkpoint.id)
  })
})
