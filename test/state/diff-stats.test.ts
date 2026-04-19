import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient } from '../../src/api/client'
import { installMockEventSource, MockEventSource } from '../sse-mock'
import type { ApiSession, ApiDagGraph, VersionInfo, WorkspaceDiff } from '../../src/api/types'

const BASE_URL = 'https://example.com'
const TOKEN = 'tok'

const SESSION: ApiSession = {
  id: 's1',
  slug: 'fast-cat',
  status: 'running',
  command: '/task x',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
  branch: 'feature/x',
  repo: 'https://github.com/acme/widgets',
}
const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: ['diff-viewer'] }
const DAGS: ApiDagGraph[] = []

const DIFF_V1: WorkspaceDiff = {
  sessionId: 's1',
  branch: 'feature/x',
  baseBranch: 'main',
  patch: '',
  truncated: false,
  stats: { filesChanged: 2, insertions: 5, deletions: 1 },
}
const DIFF_V2: WorkspaceDiff = {
  ...DIFF_V1,
  stats: { filesChanged: 3, insertions: 10, deletions: 2 },
}

vi.mock('../../src/state/persist', () => ({
  loadSnapshot: vi.fn().mockResolvedValue(null),
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
  clearSnapshot: vi.fn().mockResolvedValue(undefined),
}))

function stubFetch(diffStack: WorkspaceDiff[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions/s1/diff')) {
      const next = diffStack.shift() ?? DIFF_V1
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: next }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [SESSION] }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: DAGS }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null, error: 'Not found' }) })
  })
}

describe('createConnectionStore diff stats cache', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
  })

  it('loadDiffStats populates diffStatsBySessionId and dedupes in-flight calls', async () => {
    const fetchMock = stubFetch([DIFF_V1])
    vi.stubGlobal('fetch', fetchMock)
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-diff-1')

    const p1 = store.loadDiffStats('s1')
    const p2 = store.loadDiffStats('s1')
    await Promise.all([p1, p2])

    const diffCalls = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes('/api/sessions/s1/diff')
    )
    expect(diffCalls.length).toBe(1)

    expect(store.diffStatsBySessionId.value.get('s1')).toEqual({
      filesChanged: 2,
      insertions: 5,
      deletions: 1,
      truncated: false,
    })
    store.dispose()
  })

  it('swallows errors and leaves the cache unchanged', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/version')) return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
      if (url.includes('/api/sessions/s1/diff')) {
        return Promise.resolve({ ok: false, status: 500, statusText: 'Err', json: () => Promise.resolve({ data: null, error: 'boom' }) })
      }
      if (url.includes('/api/sessions')) return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [SESSION] }) })
      if (url.includes('/api/dags')) return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [] }) })
      return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null, error: 'Not found' }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-diff-err')

    await expect(store.loadDiffStats('s1')).resolves.toBeUndefined()
    expect(store.diffStatsBySessionId.value.has('s1')).toBe(false)
    store.dispose()
  })

  it('session_updated SSE event refreshes a cached entry', async () => {
    const fetchMock = stubFetch([DIFF_V1, DIFF_V2])
    vi.stubGlobal('fetch', fetchMock)
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-diff-sse')

    const es = mock.instances.get(`${BASE_URL}/api/events?token=${encodeURIComponent(TOKEN)}`)
    expect(es).toBeInstanceOf(MockEventSource)
    es?.simulateOpen()
    await new Promise((r) => setTimeout(r, 0))

    await store.loadDiffStats('s1')
    expect(store.diffStatsBySessionId.value.get('s1')?.insertions).toBe(5)

    es?.push({
      type: 'session_updated',
      session: { ...SESSION, updatedAt: '2024-01-02' },
    })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(store.diffStatsBySessionId.value.get('s1')?.insertions).toBe(10)
    store.dispose()
  })

  it('session_deleted SSE event drops the cache entry', async () => {
    const fetchMock = stubFetch([DIFF_V1])
    vi.stubGlobal('fetch', fetchMock)
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-diff-del')

    const es = mock.instances.get(`${BASE_URL}/api/events?token=${encodeURIComponent(TOKEN)}`)
    es?.simulateOpen()
    await new Promise((r) => setTimeout(r, 0))

    await store.loadDiffStats('s1')
    expect(store.diffStatsBySessionId.value.has('s1')).toBe(true)

    es?.push({ type: 'session_deleted', sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(store.diffStatsBySessionId.value.has('s1')).toBe(false)
    store.dispose()
  })

  it('session_updated for an uncached session does not trigger a diff fetch', async () => {
    const fetchMock = stubFetch([])
    vi.stubGlobal('fetch', fetchMock)
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-diff-nocache')

    const es = mock.instances.get(`${BASE_URL}/api/events?token=${encodeURIComponent(TOKEN)}`)
    es?.simulateOpen()
    await new Promise((r) => setTimeout(r, 0))

    es?.push({
      type: 'session_updated',
      session: { ...SESSION, updatedAt: '2024-01-02' },
    })
    await new Promise((r) => setTimeout(r, 0))

    const diffCalls = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes('/api/sessions/s1/diff')
    )
    expect(diffCalls.length).toBe(0)
    expect(store.diffStatsBySessionId.value.has('s1')).toBe(false)
    store.dispose()
  })
})
