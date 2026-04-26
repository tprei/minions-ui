import type { Database } from 'bun:sqlite'

export type MemoryStatus = 'pending' | 'approved' | 'archived' | 'pending_deletion'
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryRow {
  id: string
  repo: string
  source_session_id: string | null
  status: MemoryStatus
  type: MemoryType
  name: string
  description: string
  content: string
  created_at: number
  updated_at: number
  reviewed_at: number | null
}

export interface CreateMemoryInput {
  id: string
  repo: string
  source_session_id: string | null
  status: MemoryStatus
  type: MemoryType
  name: string
  description: string
  content: string
}

export interface UpdateMemoryInput {
  id: string
  status?: MemoryStatus
  name?: string
  description?: string
  content?: string
  reviewed_at?: number | null
}

export interface ListMemoriesOpts {
  repo: string
  status?: MemoryStatus | MemoryStatus[]
  q?: string
  limit?: number
  offset?: number
}

export function createMemory(db: Database, input: CreateMemoryInput): MemoryRow {
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO memories (id, repo, source_session_id, status, type, name, description, content, created_at, updated_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  stmt.run(
    input.id,
    input.repo,
    input.source_session_id,
    input.status,
    input.type,
    input.name,
    input.description,
    input.content,
    now,
    now,
    null,
  )
  return getMemory(db, input.id)!
}

export function updateMemory(db: Database, input: UpdateMemoryInput): MemoryRow | null {
  const existing = getMemory(db, input.id)
  if (!existing) return null

  const now = Date.now()
  const stmt = db.prepare(
    `UPDATE memories
     SET status = COALESCE(?, status),
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         content = COALESCE(?, content),
         reviewed_at = COALESCE(?, reviewed_at),
         updated_at = ?
     WHERE id = ?`,
  )
  stmt.run(
    input.status ?? null,
    input.name ?? null,
    input.description ?? null,
    input.content ?? null,
    input.reviewed_at !== undefined ? input.reviewed_at : null,
    now,
    input.id,
  )
  return getMemory(db, input.id)
}

export function deleteMemory(db: Database, id: string): boolean {
  const stmt = db.prepare('DELETE FROM memories WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

export function getMemory(db: Database, id: string): MemoryRow | null {
  const stmt = db.prepare('SELECT * FROM memories WHERE id = ?')
  return stmt.get(id) as MemoryRow | null
}

export function listMemories(db: Database, opts: ListMemoriesOpts): MemoryRow[] {
  const { repo, status, q, limit = 100, offset = 0 } = opts

  if (q && q.trim()) {
    let sql = `SELECT m.* FROM memories m
               JOIN memories_fts fts ON m.rowid = fts.rowid
               WHERE m.repo = ? AND memories_fts MATCH ?`
    const params: (string | number)[] = [repo, q.trim()]

    if (status) {
      const statuses = Array.isArray(status) ? status : [status]
      const placeholders = statuses.map(() => '?').join(',')
      sql += ` AND m.status IN (${placeholders})`
      params.push(...statuses)
    }

    sql += ' ORDER BY m.updated_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const stmt = db.prepare(sql)
    return stmt.all(...params) as MemoryRow[]
  }

  let sql = 'SELECT * FROM memories WHERE repo = ?'
  const params: (string | number)[] = [repo]

  if (status) {
    const statuses = Array.isArray(status) ? status : [status]
    const placeholders = statuses.map(() => '?').join(',')
    sql += ` AND status IN (${placeholders})`
    params.push(...statuses)
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const stmt = db.prepare(sql)
  return stmt.all(...params) as MemoryRow[]
}

export function countPendingMemories(db: Database, repo: string): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM memories WHERE repo = ? AND status = ?')
  const result = stmt.get(repo, 'pending') as { count: number } | null
  return result?.count ?? 0
}
