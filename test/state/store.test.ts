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

  it('applySessionCreated upserts by id, avoiding duplicates when SSE echoes the same session', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-upsert')

    store.applySessionCreated(SESSION)
    expect(store.sessions.value).toHaveLength(1)

    const echoed = [...mock.instances.values()][0]
    echoed?.simulateOpen()
    echoed?.push({ type: 'session_created', session: SESSION })

    expect(store.sessions.value).toHaveLength(1)
    expect(store.sessions.value[0]).toEqual(SESSION)
    store.dispose()
  })

  it('upserts DAG snapshots when SSE replays the same graph after reconnect', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-dag-upsert')

    const graph: ApiDagGraph = {
      id: 'dag-1',
      rootTaskId: 's1',
      nodes: {},
      status: 'running',
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    }
    const replayed: ApiDagGraph = {
      ...graph,
      status: 'completed',
      updatedAt: '2026-04-25T00:01:00Z',
    }

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'dag_created', dag: graph })
    es?.push({ type: 'dag_created', dag: replayed })

    expect(store.dags.value).toHaveLength(1)
    expect(store.dags.value[0]).toEqual(replayed)
    store.dispose()
  })

  it('surfaces failed command results on the store error signal', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    const baseFetch = makeResponses()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/commands') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: { success: false, error: 'invalid transition' } }),
        })
      }
      return baseFetch(url)
    }))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-command-error')
    await Promise.resolve()
    await Promise.resolve()

    const result = await store.sendCommand({ action: 'stop', sessionId: 's1' })

    expect(result.success).toBe(false)
    expect(store.error.value).toBe('invalid transition')
    store.dispose()
  })

  it('applySessionDeleted removes the session and is a no-op when already gone', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses([SESSION]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-delete')

    await Promise.resolve()
    await Promise.resolve()

    store.applySessionDeleted(SESSION.id)
    expect(store.sessions.value).toHaveLength(0)

    store.applySessionDeleted(SESSION.id)
    expect(store.sessions.value).toHaveLength(0)
    store.dispose()
  })

  it('reconnects the SSE stream when the document becomes visible after >5s hidden', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-visibility')

    await Promise.resolve()
    expect(mock.constructedUrls).toHaveLength(1)

    const originalNow = Date.now
    let now = 1_000_000
    Date.now = () => now

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    now += 6_000
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mock.constructedUrls).toHaveLength(2)

    Date.now = originalNow
    store.dispose()
  })

  it('does not reconnect on a brief visibility blip', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-blip')

    await Promise.resolve()
    expect(mock.constructedUrls).toHaveLength(1)

    const originalNow = Date.now
    let now = 2_000_000
    Date.now = () => now

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    now += 500
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mock.constructedUrls).toHaveLength(1)

    Date.now = originalNow
    store.dispose()
  })

  it('reconnects on the online event', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-online')

    await Promise.resolve()
    expect(mock.constructedUrls).toHaveLength(1)

    window.dispatchEvent(new Event('online'))

    expect(mock.constructedUrls).toHaveLength(2)
    store.dispose()
  })

  it('reconnects on pageshow when restored from bfcache', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-bfcache')

    await Promise.resolve()
    expect(mock.constructedUrls).toHaveLength(1)

    const evt = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(evt, 'persisted', { value: true })
    window.dispatchEvent(evt)

    expect(mock.constructedUrls).toHaveLength(2)

    const evt2 = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(evt2, 'persisted', { value: false })
    window.dispatchEvent(evt2)

    expect(mock.constructedUrls).toHaveLength(2)
    store.dispose()
  })

  it('dispose() removes visibility/pageshow/online listeners', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-dispose')

    await Promise.resolve()
    expect(mock.constructedUrls).toHaveLength(1)
    store.dispose()

    window.dispatchEvent(new Event('online'))
    expect(mock.constructedUrls).toHaveLength(1)
  })

  it('increments memoryProposalsCount on memory_proposed event', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-memory-proposed')

    expect(store.memoryProposalsCount.value).toBe(0)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'memory_proposed',
      memory: {
        id: 1,
        repo: 'test/repo',
        kind: 'user',
        title: 'Test',
        body: 'Body',
        status: 'pending',
        sourceSessionId: null,
        sourceDagId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        supersededBy: null,
        reviewedAt: null,
        pinned: false,
      },
    })

    expect(store.memoryProposalsCount.value).toBe(1)

    es?.push({
      type: 'memory_proposed',
      memory: {
        id: 2,
        repo: 'test/repo',
        kind: 'feedback',
        title: 'Test 2',
        body: 'Body 2',
        status: 'pending',
        sourceSessionId: null,
        sourceDagId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        supersededBy: null,
        reviewedAt: null,
        pinned: false,
      },
    })

    expect(store.memoryProposalsCount.value).toBe(2)
    store.dispose()
  })

  it('decrements memoryProposalsCount on memory_reviewed event', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-memory-reviewed')

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'memory_proposed',
      memory: {
        id: 1,
        repo: 'test/repo',
        kind: 'user',
        title: 'Test',
        body: 'Body',
        status: 'pending',
        sourceSessionId: null,
        sourceDagId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        supersededBy: null,
        reviewedAt: null,
        pinned: false,
      },
    })

    expect(store.memoryProposalsCount.value).toBe(1)

    es?.push({
      type: 'memory_reviewed',
      memory: {
        id: 1,
        repo: 'test/repo',
        kind: 'user',
        title: 'Test',
        body: 'Body',
        status: 'approved',
        sourceSessionId: null,
        sourceDagId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        supersededBy: null,
        reviewedAt: Date.now(),
        pinned: false,
      },
    })

    expect(store.memoryProposalsCount.value).toBe(0)
    store.dispose()
  })

  it('does not decrement memoryProposalsCount below zero', async () => {
    mockLoadSnapshot.mockResolvedValue(null)
    vi.stubGlobal('fetch', makeResponses())
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-memory-floor')

    expect(store.memoryProposalsCount.value).toBe(0)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'memory_reviewed',
      memory: {
        id: 1,
        repo: 'test/repo',
        kind: 'user',
        title: 'Test',
        body: 'Body',
        status: 'approved',
        sourceSessionId: null,
        sourceDagId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        supersededBy: null,
        reviewedAt: Date.now(),
        pinned: false,
      },
    })

    expect(store.memoryProposalsCount.value).toBe(0)
    store.dispose()
  })
})
