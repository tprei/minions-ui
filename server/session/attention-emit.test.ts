import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../db/sqlite'
import { EngineEventBus } from '../events/bus'
import { maybeEmitAttention, clearAttentionCache } from './attention-emit'
import type { SessionRow } from '../db/sqlite'

function makeDb(): Database {
  const db = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  db.exec(readFileSync(schemaPath, 'utf8'))
  runMigrations(db)
  return db
}

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const now = Date.now()
  return {
    id: 'sess-attn',
    slug: 'attn-slug',
    status: 'failed',
    command: 'do thing',
    mode: 'task',
    repo: null,
    branch: null,
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: null,
    workspace_root: null,
    created_at: now - 10000,
    updated_at: now - 10000,
    needs_attention: false,
    attention_reasons: [],
    quick_actions: [],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    stage: null,
    coordinator_children: [],
    ...overrides,
  }
}

describe('maybeEmitAttention', () => {
  let db: Database
  let bus: EngineEventBus
  const emitted: unknown[] = []

  beforeEach(() => {
    db = makeDb()
    bus = new EngineEventBus()
    bus.on((e) => emitted.push(e))
    emitted.length = 0
    clearAttentionCache()

    db.run(
      `INSERT INTO sessions (id, slug, status, command, mode, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_retry_count, metadata, pipeline_advancing, stage, coordinator_children)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', '[]', '[]', 0, '{}', 0, null, null)`,
      ['sess-attn', 'attn-slug', 'failed', 'do thing', 'task', Date.now() - 10000, Date.now() - 10000],
    )
  })

  test('emits session.snapshot when session has attention reasons', () => {
    const row = makeRow({ status: 'failed' })
    maybeEmitAttention(row, { bus, getDb: () => db })
    expect(emitted.length).toBe(1)
    const ev = emitted[0] as { kind: string }
    expect(ev.kind).toBe('session.snapshot')
  })

  test('does not emit for healthy running session', () => {
    const row = makeRow({ status: 'running', updated_at: Date.now() - 1000 })
    maybeEmitAttention(row, { bus, getDb: () => db })
    expect(emitted.length).toBe(0)
  })

  test('deduplicates: second call with same reasons within window does not re-emit', () => {
    const row = makeRow({ status: 'failed' })
    maybeEmitAttention(row, { bus, getDb: () => db })
    maybeEmitAttention(row, { bus, getDb: () => db })
    expect(emitted.length).toBe(1)
  })

  test('re-emits after clearing cache', () => {
    const row = makeRow({ status: 'failed' })
    maybeEmitAttention(row, { bus, getDb: () => db })
    clearAttentionCache()
    maybeEmitAttention(row, { bus, getDb: () => db })
    expect(emitted.length).toBe(2)
  })

  test('emitted session has needsAttention=true', () => {
    const row = makeRow({ status: 'failed' })
    maybeEmitAttention(row, { bus, getDb: () => db })
    const ev = emitted[0] as { kind: string; session: { needsAttention: boolean } }
    expect(ev.session.needsAttention).toBe(true)
  })
})
