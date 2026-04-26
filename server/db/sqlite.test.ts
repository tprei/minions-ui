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
  expect(tables).toContain('memories')
  expect(tables).toContain('memories_fts')
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

test('memories table has all expected columns and constraints', () => {
  const now = Date.now()

  prepared.insertSession(db, {
    id: 'sess-memory',
    slug: 'memory-session',
    status: 'completed',
    command: 'test',
    mode: 'task',
    repo: 'test/repo',
    branch: 'main',
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

  prepared.insertDag(db, {
    id: 'dag-memory',
    root_task_id: 'task-1',
    status: 'completed',
    repo: 'test/repo',
    created_at: now,
    updated_at: now,
  })

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, source_session_id, source_dag_id, created_at, updated_at, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'user', 'Test Memory', 'Test body content', 'approved', 'sess-memory', 'dag-memory', now, now, 1],
  )

  const row = db.query<{
    id: number
    repo: string | null
    kind: string
    title: string
    body: string
    status: string
    source_session_id: string | null
    source_dag_id: string | null
    created_at: number
    updated_at: number
    superseded_by: number | null
    reviewed_at: number | null
    pinned: number
  }, [string]>('SELECT * FROM memories WHERE title = ?').get('Test Memory')

  expect(row).not.toBeNull()
  expect(row!.repo).toBe('test/repo')
  expect(row!.kind).toBe('user')
  expect(row!.title).toBe('Test Memory')
  expect(row!.body).toBe('Test body content')
  expect(row!.status).toBe('approved')
  expect(row!.source_session_id).toBe('sess-memory')
  expect(row!.source_dag_id).toBe('dag-memory')
  expect(row!.pinned).toBe(1)
})

test('memories kind constraint rejects invalid values', () => {
  const now = Date.now()

  expect(() => {
    db.run(
      `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['test/repo', 'invalid_kind', 'Test', 'Body', 'pending', now, now],
    )
  }).toThrow()
})

test('memories status constraint rejects invalid values', () => {
  const now = Date.now()

  expect(() => {
    db.run(
      `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['test/repo', 'user', 'Test', 'Body', 'invalid_status', now, now],
    )
  }).toThrow()
})

test('memories FTS5 trigger syncs on insert', () => {
  const now = Date.now()

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'feedback', 'Search Test', 'Searchable body content', 'approved', now, now],
  )

  const ftsRow = db.query<{ rowid: number, title: string, body: string }, [string]>(
    'SELECT rowid, title, body FROM memories_fts WHERE memories_fts MATCH ?'
  ).get('Searchable')

  expect(ftsRow).not.toBeNull()
  expect(ftsRow!.title).toBe('Search Test')
  expect(ftsRow!.body).toBe('Searchable body content')
})

test('memories FTS5 trigger syncs on update', () => {
  const now = Date.now()

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'project', 'Original Title', 'Original body', 'pending', now, now],
  )

  const memoryId = db.query<{ id: number }, [string]>('SELECT id FROM memories WHERE title = ?').get('Original Title')!.id

  db.run(
    'UPDATE memories SET title = ?, body = ?, updated_at = ? WHERE id = ?',
    ['Updated Title', 'Updated body with searchable text', now + 1000, memoryId],
  )

  const ftsRow = db.query<{ rowid: number, title: string, body: string }, [string]>(
    'SELECT rowid, title, body FROM memories_fts WHERE memories_fts MATCH ?'
  ).get('searchable')

  expect(ftsRow).not.toBeNull()
  expect(ftsRow!.rowid).toBe(memoryId)
  expect(ftsRow!.title).toBe('Updated Title')
  expect(ftsRow!.body).toBe('Updated body with searchable text')

  const oldMatch = db.query<{ rowid: number }, [string]>(
    'SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?'
  ).get('Original')

  expect(oldMatch).toBeNull()
})

test('memories FTS5 trigger syncs on delete', () => {
  const now = Date.now()

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'reference', 'Delete Test', 'To be deleted', 'approved', now, now],
  )

  const memoryId = db.query<{ id: number }, [string]>('SELECT id FROM memories WHERE title = ?').get('Delete Test')!.id

  const beforeDelete = db.query<{ rowid: number }, [string]>(
    'SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?'
  ).get('deleted')
  expect(beforeDelete).not.toBeNull()

  db.run('DELETE FROM memories WHERE id = ?', [memoryId])

  const afterDelete = db.query<{ rowid: number }, [string]>(
    'SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?'
  ).get('deleted')
  expect(afterDelete).toBeNull()
})

test('memories foreign key cascade on session deletion', () => {
  const now = Date.now()

  prepared.insertSession(db, {
    id: 'sess-fk',
    slug: 'fk-session',
    status: 'completed',
    command: 'test',
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

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, source_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'user', 'FK Test', 'Body', 'approved', 'sess-fk', now, now],
  )

  const beforeDelete = db.query<{ source_session_id: string | null }, [string]>(
    'SELECT source_session_id FROM memories WHERE title = ?'
  ).get('FK Test')
  expect(beforeDelete!.source_session_id).toBe('sess-fk')

  prepared.deleteSession(db, 'sess-fk')

  const afterDelete = db.query<{ source_session_id: string | null }, [string]>(
    'SELECT source_session_id FROM memories WHERE title = ?'
  ).get('FK Test')
  expect(afterDelete).not.toBeNull()
  expect(afterDelete!.source_session_id).toBeNull()
})

test('memories self-referencing superseded_by foreign key', () => {
  const now = Date.now()

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'feedback', 'Original', 'Original content', 'superseded', now, now],
  )

  const originalId = db.query<{ id: number }, [string]>('SELECT id FROM memories WHERE title = ?').get('Original')!.id

  db.run(
    `INSERT INTO memories (repo, kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test/repo', 'feedback', 'Replacement', 'New content', 'approved', now + 1000, now + 1000],
  )

  const replacementId = db.query<{ id: number }, [string]>('SELECT id FROM memories WHERE title = ?').get('Replacement')!.id

  db.run('UPDATE memories SET superseded_by = ? WHERE id = ?', [replacementId, originalId])

  const updated = db.query<{ superseded_by: number | null }, [number]>(
    'SELECT superseded_by FROM memories WHERE id = ?'
  ).get(originalId)
  expect(updated!.superseded_by).toBe(replacementId)

  db.run('DELETE FROM memories WHERE id = ?', [replacementId])

  const afterDelete = db.query<{ superseded_by: number | null }, [number]>(
    'SELECT superseded_by FROM memories WHERE id = ?'
  ).get(originalId)
  expect(afterDelete!.superseded_by).toBeNull()
})
