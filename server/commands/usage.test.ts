import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { handleUsageCommand } from './usage'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

describe('handleUsageCommand', () => {
  test('returns ok=true', () => {
    const db = makeDb()
    const result = handleUsageCommand(db)
    expect(result.ok).toBe(true)
    db.close()
  })

  test('returns stats for current month (periodStart within this month)', () => {
    const db = makeDb()
    const result = handleUsageCommand(db)
    const now = Date.now()
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    expect(result.periodStart).toBeGreaterThanOrEqual(startOfMonth.getTime() - 24 * 60 * 60 * 1000)
    expect(result.periodEnd).toBeLessThanOrEqual(now + 1000)
    db.close()
  })
})
