import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from './sqlite'
import {
  countPendingMemories,
  deleteMemory,
  getMemory,
  insertMemory,
  listMemories,
  searchMemories,
  updateMemory,
} from './memories'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('./schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

let testDb: Database

beforeEach(() => {
  testDb = setupTestDb()
})

describe('insertMemory', () => {
  test('inserts a memory and returns the ID', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: 'https://github.com/test/repo',
      kind: 'user',
      title: 'Test Memory',
      body: 'This is a test memory',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    expect(id).toBeGreaterThan(0)

    const memory = getMemory(testDb, id)
    expect(memory).toBeDefined()
    expect(memory?.title).toBe('Test Memory')
    expect(memory?.kind).toBe('user')
    expect(memory?.status).toBe('pending')
  })

  test('inserts a memory with pinned=true', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: null,
      kind: 'feedback',
      title: 'Pinned Memory',
      body: 'Important feedback',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: true,
    })

    const memory = getMemory(testDb, id)
    expect(memory?.pinned).toBe(true)
  })
})

describe('updateMemory', () => {
  test('updates memory fields', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Original Title',
      body: 'Original Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    updateMemory(testDb, id, {
      title: 'Updated Title',
      body: 'Updated Body',
      status: 'approved',
      reviewed_at: now + 1000,
      updated_at: now + 1000,
    })

    const memory = getMemory(testDb, id)
    expect(memory?.title).toBe('Updated Title')
    expect(memory?.body).toBe('Updated Body')
    expect(memory?.status).toBe('approved')
    expect(memory?.reviewed_at).toBe(now + 1000)
  })

  test('updates only specified fields', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Original Title',
      body: 'Original Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    updateMemory(testDb, id, {
      title: 'Updated Title',
      updated_at: now + 1000,
    })

    const memory = getMemory(testDb, id)
    expect(memory?.title).toBe('Updated Title')
    expect(memory?.body).toBe('Original Body')
    expect(memory?.status).toBe('pending')
  })
})

describe('getMemory', () => {
  test('returns memory by ID', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Test',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memory = getMemory(testDb, id)
    expect(memory).toBeDefined()
    expect(memory?.id).toBe(id)
  })

  test('returns null for non-existent ID', () => {
    const memory = getMemory(testDb, 9999)
    expect(memory).toBeNull()
  })
})

describe('listMemories', () => {
  test('returns all memories when no filters applied', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Memory 1',
      body: 'Body 1',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: 'repo2',
      kind: 'feedback',
      title: 'Memory 2',
      body: 'Body 2',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = listMemories(testDb)
    expect(memories).toHaveLength(2)
  })

  test('filters by repo', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Memory 1',
      body: 'Body 1',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: 'repo2',
      kind: 'user',
      title: 'Memory 2',
      body: 'Body 2',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = listMemories(testDb, { repo: 'repo1' })
    expect(memories).toHaveLength(1)
    expect(memories[0]?.repo).toBe('repo1')
  })

  test('filters by status', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Memory 1',
      body: 'Body 1',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Memory 2',
      body: 'Body 2',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = listMemories(testDb, { status: 'approved' })
    expect(memories).toHaveLength(1)
    expect(memories[0]?.status).toBe('approved')
  })

  test('filters by kind', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Memory 1',
      body: 'Body 1',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: null,
      kind: 'feedback',
      title: 'Memory 2',
      body: 'Body 2',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = listMemories(testDb, { kind: 'feedback' })
    expect(memories).toHaveLength(1)
    expect(memories[0]?.kind).toBe('feedback')
  })
})

describe('searchMemories', () => {
  test('searches memories using FTS', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'TypeScript preference',
      body: 'User prefers TypeScript over JavaScript',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: null,
      kind: 'feedback',
      title: 'Python linting',
      body: 'Use ruff for Python linting',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = searchMemories(testDb, 'TypeScript')
    expect(memories).toHaveLength(1)
    expect(memories[0]?.title).toContain('TypeScript')
  })

  test('combines search with filters', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'TypeScript preference',
      body: 'User prefers TypeScript',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'TypeScript approved',
      body: 'Use TypeScript everywhere',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const memories = searchMemories(testDb, 'TypeScript', { status: 'approved' })
    expect(memories).toHaveLength(1)
    expect(memories[0]?.status).toBe('approved')
  })
})

describe('deleteMemory', () => {
  test('deletes a memory', () => {
    const now = Date.now()
    const id = insertMemory(testDb, {
      repo: null,
      kind: 'user',
      title: 'Test',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    deleteMemory(testDb, id)

    const memory = getMemory(testDb, id)
    expect(memory).toBeNull()
  })
})

describe('countPendingMemories', () => {
  test('counts pending memories', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Pending 1',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Pending 2',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Approved',
      body: 'Body',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const count = countPendingMemories(testDb)
    expect(count).toBe(2)
  })

  test('counts pending memories for specific repo', () => {
    const now = Date.now()
    insertMemory(testDb, {
      repo: 'repo1',
      kind: 'user',
      title: 'Pending repo1',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })
    insertMemory(testDb, {
      repo: 'repo2',
      kind: 'user',
      title: 'Pending repo2',
      body: 'Body',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const count = countPendingMemories(testDb, 'repo1')
    expect(count).toBe(1)
  })
})
