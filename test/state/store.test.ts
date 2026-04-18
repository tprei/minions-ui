import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient } from '../../src/api/client'
import { installMockEventSource } from '../sse-mock'
import type { ApiSession, ApiDagGraph, VersionInfo } from '../../src/api/types'

const BASE_URL = 'https://example.com'
const TOKEN = 'tok'

const SESSION: ApiSession = {
  id: 's1', slug: 'fast-cat', status: 'running', command: '/task x', createdAt: '2024-01-01',
  updatedAt: '2024-01-01', childIds: [], needsAttention: false, attentionReasons: [], quickActions: [],
  mode: 'task', conversation: [],
}
const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }
const DAGS: ApiDagGraph[] = []

const mockLoadSnapshot = vi.fn()
const mockSaveSnapshot = vi.fn()
const mockClearSnapshot = vi.fn()

vi.mock('../../src/state/persist', () => ({
  loadSnapshot: (...args: unknown[]) => mockLoadSnapshot(...args),
  saveSnapshot: (...args: unknown[]) => mockSaveSnapshot(...args),
  clearSnapshot: (...args: unknown[]) => mockClearSnapshot(...args),
}))

function makeResponses(sessions: ApiSession[] = [], dags: ApiDagGraph[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: sessions }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: dags }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({ data: null, error: 'Not found' }) })
  })
}

describe('createConnectionStore snapshot integration', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
    mockLoadSnapshot.mockReset()
    mockSaveSnapshot.mockReset()
    mockClearSnapshot.mockReset()
    mockSaveSnapshot.mockResolvedValue(undefined)
    mockClearSnapshot.mockResolvedValue(undefined)
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('seeds signals from IDB snapshot before first refresh lands', async () => {
    const seedSnapshot = {
      v: 1 as const,
      sessions: [SESSION],
      dags: DAGS,
      version: VERSION,
      savedAt: new Date().toISOString(),
    }
    mockLoadSnapshot.mockResolvedValue(seedSnapshot)

    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-seed')

    await Promise.resolve()
    await Promise.resolve()

    expect(store.sessions.value).toContainEqual(SESSION)
    expect(store.stale.value).toBe(true)
    store.dispose()
  })

  it('refresh() success calls saveSnapshot', async () => {
    mockLoadSnapshot.mockResolvedValue(null)

    vi.useFakeTimers()
    vi.stubGlobal('fetch', makeResponses([SESSION], DAGS))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-save')

    await vi.runAllTimersAsync()

    expect(mockSaveSnapshot).toHaveBeenCalled()
    store.dispose()
  })
})
