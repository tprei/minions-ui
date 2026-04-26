import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient, ApiError } from '../src/api/client'
import { openEventStream } from '../src/api/sse'
import { installMockEventSource } from './sse-mock'
import type {
  ApiSession,
  VersionInfo,
  ApiDagGraph,
  TranscriptEvent,
  TranscriptSnapshot,
} from '../src/api/types'

const BASE_URL = 'https://example.com'
const TOKEN = 'test-token-123'

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: () => Promise.resolve(data),
  })
}

describe('ApiClient', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends Authorization header on getSessions', async () => {
    const fetchMock = mockFetch({ data: [] as ApiSession[] })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.getSessions()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('unwraps { data } envelope from getSessions', async () => {
    const sessions: ApiSession[] = [
      {
        id: '1',
        slug: 'brave-lion',
        status: 'running',
        command: '/task foo',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        childIds: [],
        needsAttention: false,
        attentionReasons: [],
        quickActions: [],
        mode: 'task',
        conversation: [],
      },
    ]
    vi.stubGlobal('fetch', mockFetch({ data: sessions }))

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const result = await client.getSessions()
    expect(result).toEqual(sessions)
  })

  it('throws ApiError with status 401 for unauthorized', async () => {
    vi.stubGlobal('fetch', mockFetch({ data: null, error: 'Unauthorized' }, 401))

    const client = createApiClient({ baseUrl: BASE_URL, token: 'bad-token' })
    await expect(client.getSessions()).rejects.toThrow(ApiError)
    try {
      await client.getSessions()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(401)
    }
  })

  it('sendMessage POSTs JSON body with text field', async () => {
    const fetchMock = mockFetch({ data: { ok: true, sessionId: null } })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.sendMessage('/task hi')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/messages')
    const body = JSON.parse(init.body as string) as { text: string }
    expect(body.text).toBe('/task hi')
  })

  it('openEventStream uses ?token= query param', () => {
    vi.stubGlobal('fetch', mockFetch({ data: [] as ApiDagGraph[] }))

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const handle = client.openEventStream({ onEvent: () => {} })

    const url = mock.constructedUrls[0]
    expect(url).toContain(`token=${encodeURIComponent(TOKEN)}`)
    handle.close()
  })

  it('getTranscript fetches transcript snapshot for a session slug', async () => {
    const snapshot: TranscriptSnapshot = {
      session: {
        sessionId: 'sess-1',
        topicName: 'fix bug',
        startedAt: 1700000000,
        active: true,
      },
      events: [
        {
          seq: 1,
          id: 'e1',
          sessionId: 'sess-1',
          turn: 1,
          timestamp: 1700000001,
          type: 'user_message',
          text: 'hello',
        },
      ],
      highWaterMark: 1,
    }
    const fetchMock = mockFetch({ data: snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const result = await client.getTranscript('brave-lion')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/api/sessions/brave-lion/transcript`)
    expect(result).toEqual(snapshot)
  })

  it('getTranscript passes afterSeq query param', async () => {
    const snapshot: TranscriptSnapshot = {
      session: { sessionId: 's1', startedAt: 0 },
      events: [],
      highWaterMark: 5,
    }
    const fetchMock = mockFetch({ data: snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.getTranscript('brave-lion', 5)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/transcript?after=5')
  })

  it('listCheckpoints fetches session checkpoints', async () => {
    const fetchMock = mockFetch({ data: [] })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.listCheckpoints('sess/1')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/api/sessions/sess%2F1/checkpoints`)
  })

  it('restoreCheckpoint posts to the checkpoint restore endpoint', async () => {
    const fetchMock = mockFetch({ data: { checkpoint: null, session: null } })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.restoreCheckpoint('sess-1', 'cp/1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/sessions/sess-1/checkpoints/cp%2F1/restore`)
    expect(init.method).toBe('POST')
  })

  it('openEventStream delivers transcript_event via onEvent', () => {
    vi.stubGlobal('fetch', mockFetch({ data: [] }))

    const events: Array<{ type: string }> = []
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const handle = client.openEventStream({ onEvent: (e) => events.push(e) })

    const instance = [...mock.instances.values()][0]
    instance.simulateOpen()

    const transcriptEvt: TranscriptEvent = {
      seq: 1,
      id: 'te1',
      sessionId: 'sess-1',
      turn: 1,
      timestamp: 1700000001,
      type: 'assistant_text',
      blockId: 'b1',
      text: 'hi',
      final: true,
    }
    instance.push({ type: 'transcript_event', sessionId: 'sess-1', event: transcriptEvt })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('transcript_event')
    handle.close()
  })

  it('openEventStream reconnects when the quiet watchdog expires', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const handle = openEventStream({
      baseUrl: BASE_URL,
      token: TOKEN,
      handlers: { onEvent: () => {} },
      quietTimeoutMs: 1000,
    })

    const instance = [...mock.instances.values()][0]
    instance.simulateOpen()

    await vi.advanceTimersByTimeAsync(1001)

    expect(mock.constructedUrls).toHaveLength(2)
    handle.close()
  })

  it('openEventStream treats keepalive events as activity', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const handle = openEventStream({
      baseUrl: BASE_URL,
      token: TOKEN,
      handlers: { onEvent: () => {} },
      quietTimeoutMs: 1000,
    })

    const instance = [...mock.instances.values()][0]
    instance.simulateOpen()

    await vi.advanceTimersByTimeAsync(800)
    instance.dispatchEvent(new Event('keepalive'))
    await vi.advanceTimersByTimeAsync(800)

    expect(mock.constructedUrls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(201)

    expect(mock.constructedUrls).toHaveLength(2)
    handle.close()
  })

  it('openEventStream keeps the stream live across proxied snapshot closes', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const statuses: string[] = []
    const reconnects: boolean[] = []
    const handle = openEventStream({
      baseUrl: BASE_URL,
      token: TOKEN,
      handlers: {
        onEvent: () => {},
        onStatusChange: (status) => statuses.push(status),
        onReconnect: (event) => reconnects.push(event.quiet),
      },
      quietTimeoutMs: 1000,
    })

    const instance = [...mock.instances.values()][0]
    instance.simulateOpen()
    instance.dispatchEvent(new Event('keepalive'))
    instance.simulateError()

    expect(handle.status.value).toBe('live')
    expect(handle.reconnectAt.value).toBeNull()
    expect(statuses).not.toContain('retrying')
    expect(reconnects).toEqual([false])

    await vi.advanceTimersByTimeAsync(1000)

    const reconnected = [...mock.instances.values()][0]
    reconnected.simulateOpen()

    expect(mock.constructedUrls).toHaveLength(2)
    expect(handle.status.value).toBe('live')
    expect(handle.reconnectAt.value).toBeNull()
    expect(statuses).not.toContain('retrying')
    expect(statuses.filter((status) => status === 'connecting')).toHaveLength(1)
    expect(reconnects).toEqual([false, true])

    handle.close()
  })

  it('openEventStream surfaces retrying when a quiet reconnect gets no activity', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const statuses: string[] = []
    const handle = openEventStream({
      baseUrl: BASE_URL,
      token: TOKEN,
      handlers: {
        onEvent: () => {},
        onStatusChange: (status) => statuses.push(status),
      },
      quietTimeoutMs: 1000,
    })

    const first = [...mock.instances.values()][0]
    first.simulateOpen()
    first.dispatchEvent(new Event('keepalive'))
    first.simulateError()

    await vi.advanceTimersByTimeAsync(1000)

    const second = [...mock.instances.values()][0]
    second.simulateOpen()
    second.simulateError()

    expect(handle.status.value).toBe('retrying')
    expect(handle.reconnectAt.value).not.toBeNull()
    expect(statuses).toContain('retrying')

    handle.close()
  })

  it('strips trailing slash from baseUrl', async () => {
    const fetchMock = mockFetch({ data: { apiVersion: '1', libraryVersion: '0.0.1', features: [] } as VersionInfo })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: 'https://example.com/', token: TOKEN })
    await client.getVersion()

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://example.com/api/version')
  })
})
