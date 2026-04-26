import { describe, test, expect, beforeEach } from 'bun:test'
import Database from 'bun:sqlite'
import { buildMemoryPreamble } from './memory-preamble'
import { insertMemory } from '../db/memories'

describe('buildMemoryPreamble', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        source_session_id TEXT,
        source_dag_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        superseded_by INTEGER,
        reviewed_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0
      )
    `)
  })

  test('returns empty string when no memories exist', () => {
    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toBe('')
  })

  test('returns empty string when no approved memories exist', () => {
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Pending memory',
      body: 'This is pending',
      status: 'pending',
      source_session_id: null,
      source_dag_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      superseded_by: null,
      reviewed_at: null,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toBe('')
  })

  test('includes pinned approved memory with full content', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'feedback',
      title: 'Always use TypeScript',
      body: 'The team prefers TypeScript over JavaScript for all new files.',
      status: 'approved',
      source_session_id: 'abc123def456',
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: true,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toContain('# Repo memory')
    expect(result).toContain('## Pinned memories')
    expect(result).toContain('### Always use TypeScript')
    expect(result).toContain('The team prefers TypeScript over JavaScript for all new files.')
    expect(result).toContain('Kind: feedback')
    expect(result).toContain('Source: abc123de')
  })

  test('includes index of non-pinned approved memories', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Senior engineer',
      body: 'User is a senior software engineer with 10 years of experience.',
      status: 'approved',
      source_session_id: 'session-001',
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    insertMemory(db, {
      repo: 'test-repo',
      kind: 'project',
      title: 'Q1 migration',
      body: 'Database migration scheduled for Q1.',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toContain('# Repo memory')
    expect(result).toContain('## Memory index')
    expect(result).toContain('| ID | Kind | Title | Source | Created |')
    expect(result).toContain('| 1 | user | Senior engineer | session- |')
    expect(result).toContain('| 2 | project | Q1 migration | — |')
  })

  test('includes both pinned and index memories', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'feedback',
      title: 'No console.log',
      body: 'Never commit console.log statements.',
      status: 'approved',
      source_session_id: 'abc123',
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: true,
    })

    insertMemory(db, {
      repo: 'test-repo',
      kind: 'reference',
      title: 'API docs',
      body: 'API documentation at https://api.example.com/docs',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toContain('## Pinned memories')
    expect(result).toContain('### No console.log')
    expect(result).toContain('Never commit console.log statements.')
    expect(result).toContain('## Memory index')
    expect(result).toContain('| 2 | reference | API docs |')
  })

  test('filters memories by repo', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'repo-a',
      kind: 'user',
      title: 'Repo A memory',
      body: 'This is for repo A',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    insertMemory(db, {
      repo: 'repo-b',
      kind: 'user',
      title: 'Repo B memory',
      body: 'This is for repo B',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'repo-a' })
    expect(result).toContain('Repo A memory')
    expect(result).not.toContain('Repo B memory')
  })

  test('formats dates as YYYY-MM-DD', () => {
    const testDate = new Date('2026-04-15T10:30:00Z').getTime()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Test memory',
      body: 'Test body',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: testDate,
      updated_at: testDate,
      superseded_by: null,
      reviewed_at: testDate,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toContain('2026-04-15')
  })

  test('formats session ID as first 8 characters', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Test memory',
      body: 'Test body',
      status: 'approved',
      source_session_id: 'abcdefghijklmnop',
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toContain('abcdefgh')
    expect(result).not.toContain('abcdefghijklmnop')
  })

  test('handles null repo filter', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: null,
      kind: 'user',
      title: 'Global memory',
      body: 'This is a global memory',
      status: 'approved',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: null })
    expect(result).toContain('Global memory')
  })

  test('excludes rejected memories', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Rejected memory',
      body: 'This should not appear',
      status: 'rejected',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: null,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toBe('')
  })

  test('excludes superseded memories', () => {
    const now = Date.now()
    insertMemory(db, {
      repo: 'test-repo',
      kind: 'user',
      title: 'Superseded memory',
      body: 'This should not appear',
      status: 'superseded',
      source_session_id: null,
      source_dag_id: null,
      created_at: now,
      updated_at: now,
      superseded_by: 2,
      reviewed_at: now,
      pinned: false,
    })

    const result = buildMemoryPreamble({ db, repo: 'test-repo' })
    expect(result).toBe('')
  })
})
