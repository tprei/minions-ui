import type { Database } from 'bun:sqlite'

export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference'
export type MemoryStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'pending_deletion'

export interface MemoryRow {
  id: number
  repo: string | null
  kind: MemoryKind
  title: string
  body: string
  status: MemoryStatus
  source_session_id: string | null
  source_dag_id: string | null
  created_at: number
  updated_at: number
  superseded_by: number | null
  reviewed_at: number | null
  pinned: boolean
}

interface MemoryDbRow {
  id: number
  repo: string | null
  kind: MemoryKind
  title: string
  body: string
  status: MemoryStatus
  source_session_id: string | null
  source_dag_id: string | null
  created_at: number
  updated_at: number
  superseded_by: number | null
  reviewed_at: number | null
  pinned: number
}

type MemoryStmtCache = {
  insertMemory?: ReturnType<Database['prepare']>
  updateMemory?: ReturnType<Database['prepare']>
  getMemory?: ReturnType<Database['prepare']>
  listMemories?: ReturnType<Database['prepare']>
  deleteMemory?: ReturnType<Database['prepare']>
  searchMemories?: ReturnType<Database['prepare']>
  countPendingMemories?: ReturnType<Database['prepare']>
}

const memoryCaches = new WeakMap<Database, MemoryStmtCache>()

function memoryStmts(db: Database): MemoryStmtCache {
  let c = memoryCaches.get(db)
  if (!c) {
    c = {}
    memoryCaches.set(db, c)
  }
  return c
}

function mapMemoryRow(row: MemoryDbRow): MemoryRow {
  return {
    ...row,
    pinned: row.pinned !== 0,
  }
}

export function insertMemory(
  db: Database,
  row: Omit<MemoryRow, 'id'>,
): number {
  const c = memoryStmts(db)
  if (!c.insertMemory) {
    c.insertMemory = db.prepare(
      `INSERT INTO memories (repo, kind, title, body, status, source_session_id, source_dag_id, created_at, updated_at, superseded_by, reviewed_at, pinned)
       VALUES ($repo, $kind, $title, $body, $status, $source_session_id, $source_dag_id, $created_at, $updated_at, $superseded_by, $reviewed_at, $pinned)`,
    )
  }
  c.insertMemory.run({
    $repo: row.repo,
    $kind: row.kind,
    $title: row.title,
    $body: row.body,
    $status: row.status,
    $source_session_id: row.source_session_id,
    $source_dag_id: row.source_dag_id,
    $created_at: row.created_at,
    $updated_at: row.updated_at,
    $superseded_by: row.superseded_by,
    $reviewed_at: row.reviewed_at,
    $pinned: row.pinned ? 1 : 0,
  })
  return db.query<{ id: number }, []>('SELECT last_insert_rowid() as id').get()!.id
}

export function updateMemory(
  db: Database,
  id: number,
  updates: Partial<Omit<MemoryRow, 'id' | 'created_at'>>,
): void {
  const c = memoryStmts(db)
  if (!c.updateMemory) {
    c.updateMemory = db.prepare(
      `UPDATE memories
       SET repo = COALESCE($repo, repo),
           kind = COALESCE($kind, kind),
           title = COALESCE($title, title),
           body = COALESCE($body, body),
           status = COALESCE($status, status),
           source_session_id = COALESCE($source_session_id, source_session_id),
           source_dag_id = COALESCE($source_dag_id, source_dag_id),
           updated_at = COALESCE($updated_at, updated_at),
           superseded_by = COALESCE($superseded_by, superseded_by),
           reviewed_at = COALESCE($reviewed_at, reviewed_at),
           pinned = COALESCE($pinned, pinned)
       WHERE id = $id`,
    )
  }
  c.updateMemory.run({
    $id: id,
    $repo: updates.repo ?? null,
    $kind: updates.kind ?? null,
    $title: updates.title ?? null,
    $body: updates.body ?? null,
    $status: updates.status ?? null,
    $source_session_id: updates.source_session_id ?? null,
    $source_dag_id: updates.source_dag_id ?? null,
    $updated_at: updates.updated_at ?? null,
    $superseded_by: updates.superseded_by ?? null,
    $reviewed_at: updates.reviewed_at ?? null,
    $pinned: updates.pinned !== undefined ? (updates.pinned ? 1 : 0) : null,
  })
}

export function getMemory(db: Database, id: number): MemoryRow | null {
  const c = memoryStmts(db)
  if (!c.getMemory) {
    c.getMemory = db.prepare('SELECT * FROM memories WHERE id = ?')
  }
  const row = c.getMemory.get(id) as MemoryDbRow | undefined
  return row ? mapMemoryRow(row) : null
}

export function listMemories(
  db: Database,
  filters?: { repo?: string | null; status?: MemoryStatus; kind?: MemoryKind },
): MemoryRow[] {
  let sql = 'SELECT * FROM memories WHERE 1=1'
  const params: (string | number | null)[] = []

  if (filters?.repo !== undefined) {
    if (filters.repo === null) {
      sql += ' AND repo IS NULL'
    } else {
      sql += ' AND repo = ?'
      params.push(filters.repo)
    }
  }
  if (filters?.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  }
  if (filters?.kind) {
    sql += ' AND kind = ?'
    params.push(filters.kind)
  }

  sql += ' ORDER BY updated_at DESC LIMIT 1000'

  const rows = db.query<MemoryDbRow, (string | number | null)[]>(sql).all(...params)
  return rows.map(mapMemoryRow)
}

export function searchMemories(
  db: Database,
  query: string,
  filters?: { repo?: string | null; status?: MemoryStatus; kind?: MemoryKind },
): MemoryRow[] {
  let sql = `
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.id = fts.rowid
    WHERE memories_fts MATCH ?
  `
  const params: (string | number | null)[] = [query]

  if (filters?.repo !== undefined) {
    if (filters.repo === null) {
      sql += ' AND m.repo IS NULL'
    } else {
      sql += ' AND m.repo = ?'
      params.push(filters.repo)
    }
  }
  if (filters?.status) {
    sql += ' AND m.status = ?'
    params.push(filters.status)
  }
  if (filters?.kind) {
    sql += ' AND m.kind = ?'
    params.push(filters.kind)
  }

  sql += ' ORDER BY m.updated_at DESC LIMIT 100'

  const rows = db.query<MemoryDbRow, (string | number | null)[]>(sql).all(...params)
  return rows.map(mapMemoryRow)
}

export function deleteMemory(db: Database, id: number): void {
  const c = memoryStmts(db)
  if (!c.deleteMemory) {
    c.deleteMemory = db.prepare('DELETE FROM memories WHERE id = ?')
  }
  c.deleteMemory.run(id)
}

export function countPendingMemories(db: Database, repo?: string | null): number {
  const c = memoryStmts(db)
  if (!c.countPendingMemories) {
    c.countPendingMemories = db.prepare(
      'SELECT COUNT(*) as count FROM memories WHERE status = ? AND (? IS NULL OR repo = ?)',
    )
  }
  const row = c.countPendingMemories.get('pending', repo ?? null, repo ?? null) as { count: number } | undefined
  return row?.count ?? 0
}
