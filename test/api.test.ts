import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient, ApiError } from '../src/api/client'
import { installMockEventSource } from './sse-mock'
import type { ApiSession, VersionInfo, ApiDagGraph } from '../src/api/types'

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

  it('strips trailing slash from baseUrl', async () => {
    const fetchMock = mockFetch({ data: { apiVersion: '1', libraryVersion: '0.0.1', features: [] } as VersionInfo })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: 'https://example.com/', token: TOKEN })
    await client.getVersion()

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://example.com/api/version')
  })
})
