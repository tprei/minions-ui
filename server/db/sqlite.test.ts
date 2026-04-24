import { test, expect, beforeEach, afterEach } from 'bun:test'
import { unlinkSync } from 'fs'
import { openDatabase, runMigrations, prepared } from './sqlite'
import type { Database } from 'bun:sqlite'

function tempPath(): string {
  return `/tmp/minion-test-${Math.random().toString(36).slice(2)}.db`
}

let db: Database
let dbPath: string

beforeEach(() => {
  dbPath = tempPath()
  db = openDatabase(dbPath)
  runMigrations(db)
})

afterEach(() => {
  db.close()
  try {
    unlinkSync(dbPath)
  } catch (e) {
    void e
  }
})

test('opening a new DB creates all expected tables', () => {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((r) => r.name)

  expect(tables).toContain('sessions')
  expect(tables).toContain('session_events')
  expect(tables).toContain('dags')
  expect(tables).toContain('dag_nodes')
  expect(tables).toContain('push_subscriptions')
  expect(tables).toContain('vapid_keys')
  expect(tables).toContain('github_tokens')
  expect(tables).toContain('schema_migrations')
})

test('runMigrations is idempotent', () => {
  runMigrations(db)
  runMigrations(db)

  const rows = db
    .query<{ version: number }, []>('SELECT version FROM schema_migrations ORDER BY version')
    .all()

  expect(rows.length).toBeGreaterThanOrEqual(2)
  expect(rows[0]!.version).toBe(1)
  expect(rows[1]!.version).toBe(2)
})

test('insertSession + getSession round-trips correctly', () => {
  const now = Date.now()
  prepared.insertSession(db, {
    id: 'sess-1',
    slug: 'test-session',
    status: 'pending',
    command: 'bun run dev',
    mode: 'task',
    repo: 'myorg/myrepo',
    branch: 'main',
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: null,
    workspace_root: '/workspace',
    created_at: now,
    updated_at: now,
    needs_attention: true,
    attention_reasons: ['failed'],
    quick_actions: [{ type: 'retry', label: 'Retry', message: 'retry' }],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    stage: null,
    coordinator_children: [],
  })

  const row = prepared.getSession(db, 'sess-1')

  expect(row).not.toBeNull()
  expect(row!.id).toBe('sess-1')
  expect(row!.slug).toBe('test-session')
  expect(row!.status).toBe('pending')
  expect(row!.command).toBe('bun run dev')
  expect(row!.mode).toBe('task')
  expect(row!.repo).toBe('myorg/myrepo')
  expect(row!.branch).toBe('main')
  expect(row!.needs_attention).toBe(true)
  expect(row!.attention_reasons).toEqual(['failed'])
  expect(row!.conversation).toEqual([])
  expect(row!.created_at).toBe(now)
  expect(row!.stage).toBe(null)
  expect(row!.coordinator_children).toEqual([])
})

test('insertEvent + nextSeq returns monotonically increasing integers per session', () => {
  const now = Date.now()
  prepared.insertSession(db, {
    id: 'sess-seq',
    slug: 'seq-session',
    status: 'running',
    command: 'run',
    mode: 'task',
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

  const seq1 = prepared.nextSeq(db, 'sess-seq')
  prepared.insertEvent(db, {
    session_id: 'sess-seq',
    seq: seq1,
    turn: 1,
    type: 'turn_started',
    timestamp: now,
    payload: { trigger: 'user_message' },
  })

  const seq2 = prepared.nextSeq(db, 'sess-seq')
  prepared.insertEvent(db, {
    session_id: 'sess-seq',
    seq: seq2,
    turn: 1,
    type: 'assistant_text',
    timestamp: now + 1,
    payload: { text: 'hello' },
  })

  const seq3 = prepared.nextSeq(db, 'sess-seq')
  prepared.insertEvent(db, {
    session_id: 'sess-seq',
    seq: seq3,
    turn: 1,
    type: 'turn_completed',
    timestamp: now + 2,
    payload: {},
  })

  expect(seq1).toBe(1)
  expect(seq2).toBe(2)
  expect(seq3).toBe(3)
})

test('listEvents(sid, afterSeq: 5) returns only events with seq > 5, ordered by seq ascending', () => {
  const now = Date.now()
  prepared.insertSession(db, {
    id: 'sess-list',
    slug: 'list-session',
    status: 'running',
    command: 'run',
    mode: 'task',
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

  for (let i = 1; i <= 10; i++) {
    prepared.insertEvent(db, {
      session_id: 'sess-list',
      seq: i,
      turn: 1,
      type: 'status',
      timestamp: now + i,
      payload: { index: i },
    })
  }

  const events = prepared.listEvents(db, 'sess-list', 5)

  expect(events.length).toBe(5)
  expect(events[0]!.seq).toBe(6)
  expect(events[4]!.seq).toBe(10)

  for (let i = 0; i < events.length - 1; i++) {
    expect(events[i]!.seq).toBeLessThan(events[i + 1]!.seq)
  }

  expect(events[0]!.payload).toEqual({ index: 6 })
})

test('migration 0007 migrates legacy ship modes to ship with stage', () => {
  const dbPath = tempPath()
  const testDb = openDatabase(dbPath)
  runMigrations(testDb)
  const now = Date.now()

  try {

    testDb.exec('DELETE FROM sessions')

    testDb.run(
      `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'ship-think-id',
        'ship-think-slug',
        'completed',
        'ship feature X',
        'ship-think',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        now,
        now,
        0,
        '[]',
        '[]',
        '[]',
        null,
        0,
        '{}',
        0,
        null,
        null,
      ],
    )

    testDb.run(
      `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'ship-plan-id',
        'ship-plan-slug',
        'running',
        'ship feature Y',
        'ship-plan',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        now,
        now,
        0,
        '[]',
        '[]',
        '[]',
        null,
        0,
        '{}',
        0,
        null,
        null,
      ],
    )

    testDb.run(
      `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'ship-verify-id',
        'ship-verify-slug',
        'pending',
        'ship feature Z',
        'ship-verify',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        now,
        now,
        0,
        '[]',
        '[]',
        '[]',
        null,
        0,
        '{}',
        0,
        null,
        null,
      ],
    )

    const updateSql = `
      UPDATE sessions
      SET mode = 'ship',
          stage = CASE mode
            WHEN 'ship-think' THEN 'think'
            WHEN 'ship-plan' THEN 'plan'
            WHEN 'ship-verify' THEN 'verify'
            ELSE stage
          END
      WHERE mode IN ('ship-think', 'ship-plan', 'ship-verify')
    `
    testDb.run(updateSql)

    const thinkRow = prepared.getSession(testDb, 'ship-think-id')
    expect(thinkRow).not.toBeNull()
    expect(thinkRow!.mode).toBe('ship')
    expect(thinkRow!.stage).toBe('think')

    const planRow = prepared.getSession(testDb, 'ship-plan-id')
    expect(planRow).not.toBeNull()
    expect(planRow!.mode).toBe('ship')
    expect(planRow!.stage).toBe('plan')

    const verifyRow = prepared.getSession(testDb, 'ship-verify-id')
    expect(verifyRow).not.toBeNull()
    expect(verifyRow!.mode).toBe('ship')
    expect(verifyRow!.stage).toBe('verify')
  } finally {
    testDb.close()
    try {
      unlinkSync(dbPath)
    } catch (e) {
      void e
    }
  }
})
