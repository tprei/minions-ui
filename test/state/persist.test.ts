import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('idb-keyval', () => ({
  get: vi.fn((k: string) => Promise.resolve(store.get(k))),
  set: vi.fn((k: string, v: unknown) => { store.set(k, v); return Promise.resolve() }),
  del: vi.fn((k: string) => { store.delete(k); return Promise.resolve() }),
}))

import { saveSnapshot, loadSnapshot, clearSnapshot } from '../../src/state/persist'
import type { ApiSession, ApiDagGraph, VersionInfo } from '../../src/api/types'

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }
const SESSIONS: ApiSession[] = [
  {
    id: 's1', slug: 'fast-cat', status: 'running', command: '/task', createdAt: '2024-01-01',
    updatedAt: '2024-01-01', childIds: [], needsAttention: false, attentionReasons: [], quickActions: [],
    mode: 'task', conversation: [],
  },
]
const DAGS: ApiDagGraph[] = []

describe('persist', () => {
  beforeEach(() => {
    store.clear()
  })

  it('round-trips saveSnapshot / loadSnapshot', async () => {
    await saveSnapshot('conn-1', { sessions: SESSIONS, dags: DAGS, version: VERSION })
    const snap = await loadSnapshot('conn-1')
    expect(snap).not.toBeNull()
    expect(snap!.v).toBe(1)
    expect(snap!.sessions).toEqual(SESSIONS)
    expect(snap!.dags).toEqual(DAGS)
    expect(snap!.version).toEqual(VERSION)
    expect(snap!.savedAt).toBeTruthy()
  })

  it('loadSnapshot returns null when no entry exists', async () => {
    const snap = await loadSnapshot('missing')
    expect(snap).toBeNull()
  })

  it('loadSnapshot returns null for unknown version', async () => {
    store.set('minions-ui:snapshot:bad', { v: 99, sessions: [], dags: [], version: VERSION, savedAt: '' })
    const snap = await loadSnapshot('bad')
    expect(snap).toBeNull()
  })

  it('clearSnapshot removes the entry', async () => {
    await saveSnapshot('conn-2', { sessions: SESSIONS, dags: DAGS, version: VERSION })
    await clearSnapshot('conn-2')
    const snap = await loadSnapshot('conn-2')
    expect(snap).toBeNull()
  })
})
