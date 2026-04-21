import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { openDatabase, runMigrations } from '../db/sqlite'
import { upsertLoop, getLoop, listLoops, setLoopEnabled, setLoopInterval, recordLoopRun } from './store'
import type { LoopDefinition } from './definitions'

function makeTestDb(): Database {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return db
}

const testDef: LoopDefinition = {
  id: 'test-loop',
  title: 'Test Loop',
  description: 'A test loop',
  intervalMs: 8 * 60 * 60 * 1000,
  branchPrefix: 'minions/loops/test-loop',
  promptTemplate: 'Do the thing.',
}

describe('loops store', () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
  })

  test('upsertLoop inserts a new loop row', () => {
    upsertLoop(db, testDef)
    const row = getLoop(db, 'test-loop')
    expect(row).not.toBeNull()
    expect(row!.id).toBe('test-loop')
    expect(row!.enabled).toBe(true)
    expect(row!.interval_ms).toBe(testDef.intervalMs)
    expect(row!.consecutive_failures).toBe(0)
    expect(row!.last_run_at).toBeNull()
  })

  test('upsertLoop is idempotent', () => {
    upsertLoop(db, testDef)
    upsertLoop(db, testDef)
    const rows = listLoops(db)
    expect(rows.filter((r) => r.id === 'test-loop')).toHaveLength(1)
  })

  test('setLoopEnabled disables and re-enables', () => {
    upsertLoop(db, testDef)
    setLoopEnabled(db, 'test-loop', false)
    expect(getLoop(db, 'test-loop')!.enabled).toBe(false)
    setLoopEnabled(db, 'test-loop', true)
    expect(getLoop(db, 'test-loop')!.enabled).toBe(true)
  })

  test('setLoopInterval updates the interval', () => {
    upsertLoop(db, testDef)
    setLoopInterval(db, 'test-loop', 999)
    expect(getLoop(db, 'test-loop')!.interval_ms).toBe(999)
  })

  test('recordLoopRun sets consecutive_failures and last_run_at', () => {
    upsertLoop(db, testDef)
    const before = Date.now()
    recordLoopRun(db, 'test-loop', 2, 'https://github.com/org/repo/pull/42')
    const row = getLoop(db, 'test-loop')!
    expect(row.consecutive_failures).toBe(2)
    expect(row.last_run_at).toBeGreaterThanOrEqual(before)
    expect(row.last_pr_url).toBe('https://github.com/org/repo/pull/42')
  })

  test('listLoops returns all rows', () => {
    const defs: LoopDefinition[] = [
      { ...testDef, id: 'a' },
      { ...testDef, id: 'b' },
      { ...testDef, id: 'c' },
    ]
    for (const d of defs) upsertLoop(db, d)
    const rows = listLoops(db)
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  test('getLoop returns null for unknown id', () => {
    expect(getLoop(db, 'nope')).toBeNull()
  })
})
