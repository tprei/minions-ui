import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleDoneCommand, type DoneExecFn } from './done'
import type { SessionRegistry } from '../session/registry'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function seedSession(db: Database, id: string, status: string, prUrl: string | null = null): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, pr_url, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, ?, ?, 'cmd', 'task', ?, ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0)`,
    [id, `slug-${id}`, status, prUrl, now, now],
  )
}

interface TrackedRegistry extends SessionRegistry {
  closedIds: string[]
}

function makeRegistry(): TrackedRegistry {
  const closedIds: string[] = []
  return {
    closedIds,
    async create() { throw new Error('not implemented') },
    get() { return undefined },
    getBySlug() { return undefined },
    list() { return [] },
    snapshot() { return undefined },
    async stop() {},
    async close(id: string) { closedIds.push(id) },
    async reply() { return true },
    async reconcileOnBoot() {},
    async scheduleQuotaResume() {},
  }
}

function makeExec(behavior: 'success' | 'fail'): { exec: DoneExecFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const exec: DoneExecFn = async (cmd, args) => {
    calls.push({ cmd, args })
    if (behavior === 'fail') throw new Error('gh pr merge: conflicts')
    return { stdout: '', stderr: '' }
  }
  return { exec, calls }
}

describe('handleDoneCommand', () => {
  test('merges PR via gh and closes session when pr_url is set', async () => {
    const db = makeDb()
    seedSession(db, 's1', 'running', 'https://github.com/org/repo/pull/42')
    const registry = makeRegistry()
    const { exec, calls } = makeExec('success')

    const result = await handleDoneCommand('s1', { registry, db, execFile: exec })

    expect(result.ok).toBe(true)
    expect(result.merged).toBe(true)
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/42')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('gh')
    expect(calls[0]?.args).toEqual(['pr', 'merge', 'https://github.com/org/repo/pull/42', '--squash', '--delete-branch'])
    expect(registry.closedIds).toEqual(['s1'])
    db.close()
  })

  test('returns error without closing when session has no PR', async () => {
    const db = makeDb()
    seedSession(db, 's1', 'running', null)
    const registry = makeRegistry()
    const { exec, calls } = makeExec('success')

    const result = await handleDoneCommand('s1', { registry, db, execFile: exec })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no PR to merge')
    expect(calls).toHaveLength(0)
    expect(registry.closedIds).toEqual([])
    db.close()
  })

  test('returns error without closing when gh pr merge fails', async () => {
    const db = makeDb()
    seedSession(db, 's1', 'running', 'https://github.com/org/repo/pull/42')
    const registry = makeRegistry()
    const { exec } = makeExec('fail')

    const result = await handleDoneCommand('s1', { registry, db, execFile: exec })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('merge failed')
    expect(registry.closedIds).toEqual([])
    db.close()
  })

  test('unknown sessionId returns error', async () => {
    const db = makeDb()
    const registry = makeRegistry()
    const { exec } = makeExec('success')

    const result = await handleDoneCommand('no-such', { registry, db, execFile: exec })

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    db.close()
  })

  test('no sessionId uses active session', async () => {
    const db = makeDb()
    seedSession(db, 'active-1', 'running', 'https://github.com/org/repo/pull/7')
    const registry = makeRegistry()
    const { exec } = makeExec('success')

    const result = await handleDoneCommand(undefined, { registry, db, execFile: exec })

    expect(result.ok).toBe(true)
    expect(result.sessionId).toBe('active-1')
    expect(registry.closedIds).toEqual(['active-1'])
    db.close()
  })

  test('no sessionId with no active session returns error', async () => {
    const db = makeDb()
    const registry = makeRegistry()
    const { exec } = makeExec('success')

    const result = await handleDoneCommand(undefined, { registry, db, execFile: exec })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no active session')
    db.close()
  })
})
