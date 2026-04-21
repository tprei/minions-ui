import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleLoopsCommand } from './loops'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function seedLoop(db: Database, id = 'test-loop', enabled = true): void {
  const now = Date.now()
  db.run(
    `INSERT INTO loops (id, enabled, interval_ms, last_run_at, consecutive_failures, last_pr_url, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 0, NULL, ?, ?)`,
    [id, enabled ? 1 : 0, 3_600_000, now, now],
  )
}

describe('handleLoopsCommand', () => {
  test('list with no loops → ok empty message', () => {
    const db = makeDb()
    const result = handleLoopsCommand('list', db)
    expect(result.ok).toBe(true)
    expect(result.text).toBeTruthy()
    db.close()
  })

  test('list shows loop info', () => {
    const db = makeDb()
    seedLoop(db, 'my-loop', true)
    const result = handleLoopsCommand('list', db)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('my-loop')
    expect(result.loops?.length).toBe(1)
    db.close()
  })

  test('enable unknown loop returns error', () => {
    const db = makeDb()
    const result = handleLoopsCommand('enable no-such-loop', db)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    db.close()
  })

  test('enable existing loop sets enabled=true', () => {
    const db = makeDb()
    seedLoop(db, 'loop-a', false)
    const result = handleLoopsCommand('enable loop-a', db)
    expect(result.ok).toBe(true)
    const row = db.query<{ enabled: number }, []>('SELECT enabled FROM loops').get()
    expect(row?.enabled).toBe(1)
    db.close()
  })

  test('disable existing loop sets enabled=false', () => {
    const db = makeDb()
    seedLoop(db, 'loop-b', true)
    const result = handleLoopsCommand('disable loop-b', db)
    expect(result.ok).toBe(true)
    const row = db.query<{ enabled: number }, []>('SELECT enabled FROM loops').get()
    expect(row?.enabled).toBe(0)
    db.close()
  })

  test('unknown subcommand returns error', () => {
    const db = makeDb()
    const result = handleLoopsCommand('bogus', db)
    expect(result.ok).toBe(false)
    db.close()
  })

  test('missing id for enable returns error', () => {
    const db = makeDb()
    const result = handleLoopsCommand('enable', db)
    expect(result.ok).toBe(false)
    db.close()
  })
})
