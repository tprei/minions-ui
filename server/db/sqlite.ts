import { Database } from 'bun:sqlite'
import * as fs from 'fs'
import * as path from 'path'
import { readdirSync, readFileSync } from 'fs'

type SessionStatus = 'pending' | 'running' | 'waiting_input' | 'completed' | 'failed'
type DagStatus = 'pending' | 'running' | 'completed' | 'failed'
type DagNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'ci-pending' | 'ci-failed' | 'landed'

export interface SessionRow {
  id: string
  slug: string
  status: SessionStatus
  command: string
  mode: string
  repo: string | null
  branch: string | null
  bare_dir: string | null
  pr_url: string | null
  parent_id: string | null
  variant_group_id: string | null
  claude_session_id: string | null
  workspace_root: string | null
  created_at: number
  updated_at: number
  needs_attention: boolean
  attention_reasons: unknown[]
  quick_actions: unknown[]
  conversation: unknown[]
  quota_sleep_until: number | null
  quota_retry_count: number
  metadata: Record<string, unknown>
  pipeline_advancing: boolean
  stage: string | null
  coordinator_children: string[]
}

interface SessionDbRow {
  id: string
  slug: string
  status: SessionStatus
  command: string
  mode: string
  repo: string | null
  branch: string | null
  bare_dir: string | null
  pr_url: string | null
  parent_id: string | null
  variant_group_id: string | null
  claude_session_id: string | null
  workspace_root: string | null
  created_at: number
  updated_at: number
  needs_attention: number
  attention_reasons: string
  quick_actions: string
  conversation: string
  quota_sleep_until: number | null
  quota_retry_count: number
  metadata: string
  pipeline_advancing: number
  stage: string | null
  coordinator_children: string | null
}

interface SessionEventRow {
  session_id: string
  seq: number
  turn: number
  type: string
  timestamp: number
  payload: Record<string, unknown>
}

interface SessionEventDbRow {
  session_id: string
  seq: number
  turn: number
  type: string
  timestamp: number
  payload: string
}

interface DagRow {
  id: string
  root_task_id: string
  status: DagStatus
  repo: string | null
  created_at: number
  updated_at: number
}

interface DagNodeRow {
  dag_id: string
  id: string
  slug: string
  status: DagNodeStatus
  session_id: string | null
  dependencies: string[]
  dependents: string[]
  payload: Record<string, unknown>
}

interface DagNodeDbRow {
  dag_id: string
  id: string
  slug: string
  status: DagNodeStatus
  session_id: string | null
  dependencies: string
  dependents: string
  payload: string
}

interface MigrationRow {
  version: number
  name: string
  applied_at: number
}

type StmtCache = {
  insertSession?: ReturnType<Database['prepare']>
  updateSession?: ReturnType<Database['prepare']>
  getSession?: ReturnType<Database['prepare']>
  listSessions?: ReturnType<Database['prepare']>
  deleteSession?: ReturnType<Database['prepare']>
  insertEvent?: ReturnType<Database['prepare']>
  insertDag?: ReturnType<Database['prepare']>
  updateDag?: ReturnType<Database['prepare']>
  getDag?: ReturnType<Database['prepare']>
  listDags?: ReturnType<Database['prepare']>
  deleteDag?: ReturnType<Database['prepare']>
  upsertDagNode?: ReturnType<Database['prepare']>
}

const dbCaches = new WeakMap<Database, StmtCache>()

function stmts(db: Database): StmtCache {
  let c = dbCaches.get(db)
  if (!c) {
    c = {}
    dbCaches.set(db, c)
  }
  return c
}

function mapSessionRow(row: SessionDbRow): SessionRow {
  return {
    ...row,
    needs_attention: row.needs_attention !== 0,
    attention_reasons: JSON.parse(row.attention_reasons) as unknown[],
    quick_actions: JSON.parse(row.quick_actions) as unknown[],
    conversation: JSON.parse(row.conversation) as unknown[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    pipeline_advancing: row.pipeline_advancing !== 0,
    coordinator_children: row.coordinator_children ? (JSON.parse(row.coordinator_children) as string[]) : [],
  }
}


function mapEventRow(row: SessionEventDbRow): SessionEventRow {
  return {
    ...row,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }
}

function mapDagNodeRow(row: DagNodeDbRow): DagNodeRow {
  return {
    ...row,
    dependencies: JSON.parse(row.dependencies) as string[],
    dependents: JSON.parse(row.dependents) as string[],
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }
}

let singleton: Database | null = null

export function openDatabase(dbPath: string): Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath, { create: true })
  const schemaPath = path.join(import.meta.dir, 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  return db
}

export function getDb(): Database {
  if (!singleton) {
    const dbPath = process.env['MINION_DB_PATH'] ?? 'data/engine.db'
    singleton = openDatabase(dbPath)
    runMigrations(singleton)
  }
  return singleton
}

export function closeDatabase(): void {
  if (singleton) {
    singleton.close()
    singleton = null
  }
}

export function runMigrations(db: Database): void {
  const migrationsDir = path.join(import.meta.dir, 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()

  for (const file of files) {
    const match = /^(\d{4})_/.exec(file)
    if (!match) continue
    const version = parseInt(match[1]!, 10)

    const existing = db
      .query<MigrationRow, [number]>('SELECT version FROM schema_migrations WHERE version = ?')
      .get(version)

    if (existing) continue

    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
    try {
      db.exec(sql)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('duplicate column name')) throw err
    }

    db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
      version,
      file,
      Date.now(),
    ])
  }
}

export const prepared = {
  insertSession(
    db: Database,
    row: SessionRow,
  ): void {
    const c = stmts(db)
    if (!c.insertSession) {
      c.insertSession = db.prepare(
        `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
         VALUES ($id, $slug, $status, $command, $mode, $repo, $branch, $bare_dir, $pr_url, $parent_id, $variant_group_id, $claude_session_id, $workspace_root, $created_at, $updated_at, $needs_attention, $attention_reasons, $quick_actions, $conversation, $quota_sleep_until, $quota_retry_count, $metadata, $pipeline_advancing, $stage, $coordinator_children)`,
      )
    }
    c.insertSession.run({
      $id: row.id,
      $slug: row.slug,
      $status: row.status,
      $command: row.command,
      $mode: row.mode,
      $repo: row.repo,
      $branch: row.branch,
      $bare_dir: row.bare_dir,
      $pr_url: row.pr_url,
      $parent_id: row.parent_id,
      $variant_group_id: row.variant_group_id,
      $claude_session_id: row.claude_session_id,
      $workspace_root: row.workspace_root,
      $created_at: row.created_at,
      $updated_at: row.updated_at,
      $needs_attention: row.needs_attention ? 1 : 0,
      $attention_reasons: JSON.stringify(row.attention_reasons),
      $quick_actions: JSON.stringify(row.quick_actions),
      $conversation: JSON.stringify(row.conversation),
      $quota_sleep_until: row.quota_sleep_until ?? null,
      $quota_retry_count: row.quota_retry_count,
      $metadata: JSON.stringify(row.metadata),
      $pipeline_advancing: row.pipeline_advancing ? 1 : 0,
      $stage: row.stage ?? null,
      $coordinator_children: row.coordinator_children.length > 0 ? JSON.stringify(row.coordinator_children) : null,
    })
  },

  updateSession(
    db: Database,
    row: Partial<Omit<SessionRow, 'id'>> & { id: string; updated_at: number },
  ): void {
    const c = stmts(db)
    if (!c.updateSession) {
      c.updateSession = db.prepare(
        `UPDATE sessions SET
          slug = COALESCE($slug, slug),
          status = COALESCE($status, status),
          command = COALESCE($command, command),
          mode = COALESCE($mode, mode),
          repo = COALESCE($repo, repo),
          branch = COALESCE($branch, branch),
          bare_dir = COALESCE($bare_dir, bare_dir),
          pr_url = COALESCE($pr_url, pr_url),
          parent_id = COALESCE($parent_id, parent_id),
          variant_group_id = COALESCE($variant_group_id, variant_group_id),
          claude_session_id = COALESCE($claude_session_id, claude_session_id),
          workspace_root = COALESCE($workspace_root, workspace_root),
          updated_at = $updated_at,
          needs_attention = COALESCE($needs_attention, needs_attention),
          attention_reasons = COALESCE($attention_reasons, attention_reasons),
          quick_actions = COALESCE($quick_actions, quick_actions),
          conversation = COALESCE($conversation, conversation),
          quota_sleep_until = COALESCE($quota_sleep_until, quota_sleep_until),
          quota_retry_count = COALESCE($quota_retry_count, quota_retry_count),
          metadata = COALESCE($metadata, metadata),
          pipeline_advancing = COALESCE($pipeline_advancing, pipeline_advancing),
          stage = COALESCE($stage, stage),
          coordinator_children = COALESCE($coordinator_children, coordinator_children)
        WHERE id = $id`,
      )
    }
    c.updateSession.run({
      $id: row.id,
      $slug: row.slug ?? null,
      $status: row.status ?? null,
      $command: row.command ?? null,
      $mode: row.mode ?? null,
      $repo: row.repo ?? null,
      $branch: row.branch ?? null,
      $bare_dir: row.bare_dir ?? null,
      $pr_url: row.pr_url ?? null,
      $parent_id: row.parent_id ?? null,
      $variant_group_id: row.variant_group_id ?? null,
      $claude_session_id: row.claude_session_id ?? null,
      $workspace_root: row.workspace_root ?? null,
      $updated_at: row.updated_at,
      $needs_attention: row.needs_attention !== undefined ? (row.needs_attention ? 1 : 0) : null,
      $attention_reasons:
        row.attention_reasons !== undefined ? JSON.stringify(row.attention_reasons) : null,
      $quick_actions: row.quick_actions !== undefined ? JSON.stringify(row.quick_actions) : null,
      $conversation: row.conversation !== undefined ? JSON.stringify(row.conversation) : null,
      $quota_sleep_until: row.quota_sleep_until !== undefined ? (row.quota_sleep_until ?? null) : null,
      $quota_retry_count: row.quota_retry_count ?? null,
      $metadata: row.metadata !== undefined ? JSON.stringify(row.metadata) : null,
      $pipeline_advancing: row.pipeline_advancing !== undefined ? (row.pipeline_advancing ? 1 : 0) : null,
      $stage: row.stage !== undefined ? row.stage : null,
      $coordinator_children: row.coordinator_children !== undefined ? (row.coordinator_children.length > 0 ? JSON.stringify(row.coordinator_children) : null) : null,
    })
  },

  getSession(db: Database, id: string): SessionRow | null {
    const c = stmts(db)
    if (!c.getSession) {
      c.getSession = db.prepare<SessionDbRow, [string]>('SELECT * FROM sessions WHERE id = ?')
    }
    const row = c.getSession.get(id) as SessionDbRow | null
    return row ? mapSessionRow(row) : null
  },

  listSessions(db: Database): SessionRow[] {
    const c = stmts(db)
    if (!c.listSessions) {
      c.listSessions = db.prepare<SessionDbRow, []>(
        'SELECT * FROM sessions ORDER BY updated_at DESC',
      )
    }
    const rows = c.listSessions.all() as SessionDbRow[]
    return rows.map(mapSessionRow)
  },

  deleteSession(db: Database, id: string): void {
    const c = stmts(db)
    if (!c.deleteSession) {
      c.deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?')
    }
    c.deleteSession.run(id)
  },

  insertEvent(
    db: Database,
    row: SessionEventRow,
  ): void {
    const c = stmts(db)
    if (!c.insertEvent) {
      c.insertEvent = db.prepare(
        `INSERT INTO session_events (session_id, seq, turn, type, timestamp, payload)
         VALUES ($session_id, $seq, $turn, $type, $timestamp, $payload)`,
      )
    }
    c.insertEvent.run({
      $session_id: row.session_id,
      $seq: row.seq,
      $turn: row.turn,
      $type: row.type,
      $timestamp: row.timestamp,
      $payload: JSON.stringify(row.payload),
    })
  },

  listEvents(db: Database, sessionId: string, afterSeq: number): SessionEventRow[] {
    const rows = db
      .query<SessionEventDbRow, [string, number]>(
        'SELECT * FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC',
      )
      .all(sessionId, afterSeq)
    return rows.map(mapEventRow)
  },

  nextSeq(db: Database, sessionId: string): number {
    const row = db
      .query<{ max_seq: number | null }, [string]>(
        'SELECT MAX(seq) as max_seq FROM session_events WHERE session_id = ?',
      )
      .get(sessionId)
    return (row?.max_seq ?? 0) + 1
  },

  insertDag(db: Database, row: DagRow): void {
    const c = stmts(db)
    if (!c.insertDag) {
      c.insertDag = db.prepare(
        `INSERT INTO dags (id, root_task_id, status, repo, created_at, updated_at)
         VALUES ($id, $root_task_id, $status, $repo, $created_at, $updated_at)`,
      )
    }
    c.insertDag.run({
      $id: row.id,
      $root_task_id: row.root_task_id,
      $status: row.status,
      $repo: row.repo,
      $created_at: row.created_at,
      $updated_at: row.updated_at,
    })
  },

  updateDag(db: Database, row: Partial<DagRow> & { id: string; updated_at: number }): void {
    const c = stmts(db)
    if (!c.updateDag) {
      c.updateDag = db.prepare(
        `UPDATE dags SET
          root_task_id = COALESCE($root_task_id, root_task_id),
          status = COALESCE($status, status),
          repo = COALESCE($repo, repo),
          updated_at = $updated_at
        WHERE id = $id`,
      )
    }
    c.updateDag.run({
      $id: row.id,
      $root_task_id: row.root_task_id ?? null,
      $status: row.status ?? null,
      $repo: row.repo ?? null,
      $updated_at: row.updated_at,
    })
  },

  getDag(db: Database, id: string): DagRow | null {
    const c = stmts(db)
    if (!c.getDag) {
      c.getDag = db.prepare<DagRow, [string]>('SELECT * FROM dags WHERE id = ?')
    }
    return c.getDag.get(id) as DagRow | null
  },

  listDags(db: Database): DagRow[] {
    const c = stmts(db)
    if (!c.listDags) {
      c.listDags = db.prepare<DagRow, []>('SELECT * FROM dags ORDER BY updated_at DESC')
    }
    return c.listDags.all() as DagRow[]
  },

  deleteDag(db: Database, id: string): void {
    const c = stmts(db)
    if (!c.deleteDag) {
      c.deleteDag = db.prepare('DELETE FROM dags WHERE id = ?')
    }
    c.deleteDag.run(id)
  },

  upsertDagNode(db: Database, row: DagNodeRow): void {
    const c = stmts(db)
    if (!c.upsertDagNode) {
      c.upsertDagNode = db.prepare(
        `INSERT INTO dag_nodes (dag_id, id, slug, status, session_id, dependencies, dependents, payload)
         VALUES ($dag_id, $id, $slug, $status, $session_id, $dependencies, $dependents, $payload)
         ON CONFLICT (dag_id, id) DO UPDATE SET
           slug = excluded.slug,
           status = excluded.status,
           session_id = excluded.session_id,
           dependencies = excluded.dependencies,
           dependents = excluded.dependents,
           payload = excluded.payload`,
      )
    }
    c.upsertDagNode.run({
      $dag_id: row.dag_id,
      $id: row.id,
      $slug: row.slug,
      $status: row.status,
      $session_id: row.session_id,
      $dependencies: JSON.stringify(row.dependencies),
      $dependents: JSON.stringify(row.dependents),
      $payload: JSON.stringify(row.payload),
    })
  },

  listDagNodes(db: Database, dagId: string): DagNodeRow[] {
    const rows = db
      .query<DagNodeDbRow, [string]>('SELECT * FROM dag_nodes WHERE dag_id = ?')
      .all(dagId)
    return rows.map(mapDagNodeRow)
  },
}
