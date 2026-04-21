import { randomUUID } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { getDb } from '../db/sqlite'

interface PushSubscriptionRow {
  id: string
  endpoint: string
  expiration_time: number | null
  p256dh: string
  auth: string
  created_at: number
}

export interface PushSubscription {
  id: string
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}

function mapRow(row: PushSubscriptionRow): PushSubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    expirationTime: row.expiration_time,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
}

export function subscribe(
  sub: { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } },
  dbProvider?: () => Database,
): PushSubscription {
  const db = (dbProvider ?? getDb)()
  const existing = db
    .query<PushSubscriptionRow, [string]>('SELECT * FROM push_subscriptions WHERE endpoint = ?')
    .get(sub.endpoint)
  if (existing) return mapRow(existing)

  const id = randomUUID()
  const now = Date.now()
  db.run(
    'INSERT INTO push_subscriptions (id, endpoint, expiration_time, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, sub.endpoint, sub.expirationTime ?? null, sub.keys.p256dh, sub.keys.auth, now],
  )
  return { id, endpoint: sub.endpoint, expirationTime: sub.expirationTime, keys: sub.keys }
}

export function unsubscribe(endpoint: string, dbProvider?: () => Database): void {
  const db = (dbProvider ?? getDb)()
  db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint])
}

export function list(dbProvider?: () => Database): PushSubscription[] {
  const db = (dbProvider ?? getDb)()
  const rows = db.query<PushSubscriptionRow, []>('SELECT * FROM push_subscriptions').all()
  return rows.map(mapRow)
}

export function removeById(id: string, dbProvider?: () => Database): void {
  const db = (dbProvider ?? getDb)()
  db.run('DELETE FROM push_subscriptions WHERE id = ?', [id])
}
