import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient } from '../src/api/client'
import { createConnectionStore } from '../src/state/store'
import { installMockEventSource, MockEventSource } from './sse-mock'
import type {
  ApiSession,
  ApiDagGraph,
  VersionInfo,
  TranscriptSnapshot,
  AssistantTextEvent,
} from '../src/api/types'

vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}))

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
}

const DAG: ApiDagGraph = {
  id: 'd1',
  rootTaskId: 's1',
  nodes: {},
  status: 'running',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function makeResponses(
  sessions: ApiSession[] = [],
  dags: ApiDagGraph[] = [],
  transcripts: Record<string, TranscriptSnapshot> = {},
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    const transcriptMatch = url.match(/\/api\/sessions\/([^/?]+)\/transcript/)
    if (transcriptMatch) {
      const snap = transcripts[decodeURIComponent(transcriptMatch[1])]
      if (snap) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: snap }) })
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({ data: null, error: 'Not found' }) })
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

describe('ConnectionStore SSE events', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function setup(initialSessions: ApiSession[] = [], initialDags: ApiDagGraph[] = []) {
    vi.stubGlobal('fetch', makeResponses(initialSessions, initialDags))
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')
    const es = [...mock.instances.values()][0] as MockEventSource
    return { store, es }
  }

  it('session_created adds session to signal', async () => {
    const { store, es } = setup()
    await Promise.resolve()
    es.push({ type: 'session_created', session: SESSION })
    expect(store.sessions.value).toContainEqual(SESSION)
    store.dispose()
  })

  it('session_updated replaces existing session', async () => {
    const { store, es } = setup([SESSION])
    await Promise.resolve()
    es.push({ type: 'session_created', session: SESSION })
    const updated = { ...SESSION, status: 'completed' as const }
    es.push({ type: 'session_updated', session: updated })
    expect(store.sessions.value[0].status).toBe('completed')
    store.dispose()
  })

  it('session_deleted removes session', async () => {
    const { store, es } = setup([SESSION])
    await Promise.resolve()
    es.push({ type: 'session_created', session: SESSION })
    es.push({ type: 'session_deleted', sessionId: 's1' })
    expect(store.sessions.value).toHaveLength(0)
    store.dispose()
  })

  it('dag_created adds dag', async () => {
    const { store, es } = setup()
    await Promise.resolve()
    es.push({ type: 'dag_created', dag: DAG })
    expect(store.dags.value).toContainEqual(DAG)
    store.dispose()
  })

  it('dag_updated replaces dag', async () => {
    const { store, es } = setup()
    await Promise.resolve()
    es.push({ type: 'dag_created', dag: DAG })
    const updated = { ...DAG, status: 'completed' as const }
    es.push({ type: 'dag_updated', dag: updated })
    expect(store.dags.value[0].status).toBe('completed')
    store.dispose()
  })

  it('dag_deleted removes dag', async () => {
    const { store, es } = setup()
    await Promise.resolve()
    es.push({ type: 'dag_created', dag: DAG })
    es.push({ type: 'dag_deleted', dagId: 'd1' })
    expect(store.dags.value).toHaveLength(0)
    store.dispose()
  })

  it('backoff delay is less than 30000ms on error', () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', makeResponses())
    const setSpy = vi.spyOn(globalThis, 'setTimeout')

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')
    const es = [...mock.instances.values()][0] as MockEventSource

    es.simulateError()

    const calls = setSpy.mock.calls.filter((c) => typeof c[1] === 'number') as [unknown, number][]
    const backoffCalls = calls.filter(([, delay]) => delay <= 30000)
    expect(backoffCalls.length).toBeGreaterThan(0)
    store.dispose()
  })

  it('onReconnect triggers refresh (fetch call count increases)', async () => {
    const fetchMock = makeResponses()
    vi.stubGlobal('fetch', fetchMock)
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')
    const es = [...mock.instances.values()][0] as MockEventSource

    await Promise.resolve()
    const countBefore = fetchMock.mock.calls.length

    es.simulateOpen()
    await Promise.resolve()

    expect(fetchMock.mock.calls.length).toBeGreaterThan(countBefore)
    store.dispose()
  })

  it('getTranscript returns null for unknown session and caches for known sessions', async () => {
    const snap: TranscriptSnapshot = {
      session: { sessionId: SESSION.id, startedAt: 1_700_000_000 },
      events: [],
      highWaterMark: 0,
    }
    vi.stubGlobal('fetch', makeResponses([SESSION], [], { [SESSION.slug]: snap }))
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')

    for (let i = 0; i < 8; i++) await Promise.resolve()

    expect(store.getTranscript('missing-id')).toBeNull()
    const ts = store.getTranscript(SESSION.id)
    expect(ts).not.toBeNull()
    const again = store.getTranscript(SESSION.id)
    expect(again).toBe(ts)
    store.dispose()
  })

  it('transcript_event SSE is routed to the matching transcript store', async () => {
    const snap: TranscriptSnapshot = {
      session: { sessionId: SESSION.id, startedAt: 1_700_000_000 },
      events: [],
      highWaterMark: 0,
    }
    vi.stubGlobal('fetch', makeResponses([SESSION], [], { [SESSION.slug]: snap }))
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')
    const es = [...mock.instances.values()][0] as MockEventSource

    store.applySessionCreated(SESSION)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    const ts = store.getTranscript(SESSION.id)
    expect(ts).not.toBeNull()
    for (let i = 0; i < 4; i++) await Promise.resolve()

    const evt: AssistantTextEvent = {
      seq: 1,
      id: 'e1',
      sessionId: SESSION.id,
      turn: 1,
      timestamp: 1_700_000_001,
      type: 'assistant_text',
      blockId: 'b1',
      text: 'hi',
      final: true,
    }
    es.push({ type: 'transcript_event', sessionId: SESSION.id, event: evt })

    expect(ts!.events.value).toHaveLength(1)
    expect(ts!.events.value[0]).toEqual(evt)
    expect(ts!.highWaterMark.value).toBe(1)
    store.dispose()
  })

  it('reconnect triggers transcript reconciliation refetch', async () => {
    const initial: TranscriptSnapshot = {
      session: { sessionId: SESSION.id, startedAt: 1_700_000_000 },
      events: [
        {
          seq: 1,
          id: 'e1',
          sessionId: SESSION.id,
          turn: 1,
          timestamp: 1_700_000_001,
          type: 'assistant_text',
          blockId: 'b1',
          text: 'one',
          final: true,
        },
      ],
      highWaterMark: 1,
    }
    const fetchMock = makeResponses([SESSION], [], { [SESSION.slug]: initial })
    vi.stubGlobal('fetch', fetchMock)
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'test-conn')
    const es = [...mock.instances.values()][0] as MockEventSource

    store.applySessionCreated(SESSION)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    const ts = store.getTranscript(SESSION.id)
    expect(ts).not.toBeNull()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(ts!.highWaterMark.value).toBe(1)

    function transcriptUrls(): string[] {
      return fetchMock.mock.calls
        .map((c) => c[0] as unknown)
        .filter((u): u is string => typeof u === 'string' && u.includes('/transcript'))
    }

    const before = transcriptUrls().length

    es.simulateOpen()
    for (let i = 0; i < 4; i++) await Promise.resolve()

    const after = transcriptUrls()
    expect(after.length).toBeGreaterThan(before)
    expect(after[after.length - 1]).toContain('after=1')
    store.dispose()
  })
})
