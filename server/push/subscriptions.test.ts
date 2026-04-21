import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { subscribe, unsubscribe, list, removeById } from './subscriptions'

function setupTestDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)
  runMigrations(db)
  return db
}

let testDb: Database

beforeEach(() => {
  testDb = setupTestDb()
})

describe('push subscriptions', () => {
  test('subscribe stores a new subscription and returns it', () => {
    const sub = subscribe(
      { endpoint: 'https://push.example.com/1', expirationTime: null, keys: { p256dh: 'pk', auth: 'ak' } },
      () => testDb,
    )
    expect(sub.id).toBeTruthy()
    expect(sub.endpoint).toBe('https://push.example.com/1')
    expect(sub.keys.p256dh).toBe('pk')
  })

  test('subscribe is idempotent for the same endpoint', () => {
    const sub1 = subscribe(
      { endpoint: 'https://push.example.com/2', expirationTime: null, keys: { p256dh: 'pk', auth: 'ak' } },
      () => testDb,
    )
    const sub2 = subscribe(
      { endpoint: 'https://push.example.com/2', expirationTime: null, keys: { p256dh: 'pk2', auth: 'ak2' } },
      () => testDb,
    )
    expect(sub1.id).toBe(sub2.id)
  })

  test('list returns all subscriptions', () => {
    subscribe(
      { endpoint: 'https://a.com/1', expirationTime: null, keys: { p256dh: 'pk1', auth: 'ak1' } },
      () => testDb,
    )
    subscribe(
      { endpoint: 'https://b.com/2', expirationTime: null, keys: { p256dh: 'pk2', auth: 'ak2' } },
      () => testDb,
    )
    const subs = list(() => testDb)
    expect(subs).toHaveLength(2)
  })

  test('unsubscribe removes by endpoint', () => {
    subscribe(
      { endpoint: 'https://to-remove.com/1', expirationTime: null, keys: { p256dh: 'pk', auth: 'ak' } },
      () => testDb,
    )
    expect(list(() => testDb)).toHaveLength(1)
    unsubscribe('https://to-remove.com/1', () => testDb)
    expect(list(() => testDb)).toHaveLength(0)
  })

  test('removeById removes by id', () => {
    const sub = subscribe(
      { endpoint: 'https://by-id.com/1', expirationTime: null, keys: { p256dh: 'pk', auth: 'ak' } },
      () => testDb,
    )
    expect(list(() => testDb)).toHaveLength(1)
    removeById(sub.id, () => testDb)
    expect(list(() => testDb)).toHaveLength(0)
  })
})
