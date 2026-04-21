import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient, ApiError } from '../../src/api/client'
import type {
  ApiSession,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  CreateSessionVariantsResult,
  PrPreview,
  PushSubscriptionJSON,
  ScreenshotList,
  VapidPublicKey,
  WorkspaceDiff,
} from '../../src/api/types'

const BASE_URL = 'https://example.com'
const TOKEN = 'test-token'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: () => Promise.resolve(data),
    blob: () => Promise.reject(new Error('not a blob response')),
  }
}

function blobResponse(body: Blob, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    blob: () => Promise.resolve(body),
    json: () => Promise.reject(new Error('not a json response')),
  }
}

const SAMPLE_SESSION: ApiSession = {
  id: 's-1',
  slug: 'quick-fox',
  status: 'pending',
  command: '/task implement feature x',
  createdAt: '2026-04-19T00:00:00Z',
  updatedAt: '2026-04-19T00:00:00Z',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
}

describe('ApiClient — createSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: SAMPLE_SESSION }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs structured payload to /api/sessions', async () => {
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const req: CreateSessionRequest = { prompt: 'do the thing', mode: 'task', repo: 'foo' }
    const out = await client.createSession(req)

    expect(out).toEqual(SAMPLE_SESSION)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/sessions`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const body = JSON.parse(init.body as string) as CreateSessionRequest
    expect(body).toEqual(req)
  })
})

describe('ApiClient — createSessionVariants', () => {
  it('POSTs to /api/sessions/variants and unwraps the variants result', async () => {
    const result: CreateSessionVariantsResult = {
      sessions: [
        { sessionId: 's-1', slug: 's-1', threadId: 1 },
        { sessionId: 's-2', slug: 's-2', threadId: 2 },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: result }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const req: CreateSessionVariantsRequest = { prompt: 'parallel', mode: 'task', count: 2 }
    const out = await client.createSessionVariants(req)

    expect(out).toEqual(result)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/api/sessions/variants`)

    vi.unstubAllGlobals()
  })
})

describe('ApiClient — getPr / getDiff / listScreenshots', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('getPr hits /api/sessions/:id/pr with encoded id', async () => {
    const pr: PrPreview = {
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      title: 'Feature',
      body: 'body',
      state: 'open',
      draft: false,
      mergeable: true,
      branch: 'feature',
      baseBranch: 'main',
      author: 'me',
      updatedAt: '2026-04-19T00:00:00Z',
      checks: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: pr }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out = await client.getPr('weird id/with/slashes')
    expect(out).toEqual(pr)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/api/sessions/${encodeURIComponent('weird id/with/slashes')}/pr`)
  })

  it('getDiff maps the wire shape to the UI shape and derives stats from the patch', async () => {
    const patch = [
      'diff --git a/foo b/foo',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1,1 +1,3 @@',
      '-x',
      '+a',
      '+b',
      '+c',
      '',
    ].join('\n')
    const wire = { base: 'main', head: 'feature', patch, truncated: false }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: wire }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out: WorkspaceDiff = await client.getDiff('s-1')
    expect(out).toEqual({
      branch: 'feature',
      baseBranch: 'main',
      patch,
      truncated: false,
      stats: { filesChanged: 1, insertions: 3, deletions: 1 },
    })
  })

  it('listScreenshots returns list shape', async () => {
    const list: ScreenshotList = {
      sessionId: 's-1',
      screenshots: [
        { file: 'a.png', url: '/api/screenshots/a.png', capturedAt: '2026-04-19T00:00:00Z', size: 100 },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: list }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out = await client.listScreenshots('s-1')
    expect(out).toEqual(list)
  })
})

describe('ApiClient — fetchScreenshotBlob', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prepends baseUrl to relative URL and attaches Authorization header', async () => {
    const body = new Blob(['fake-png'], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValue(blobResponse(body))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const relativeUrl = '/api/sessions/my-slug/screenshots/screen.png'
    const out = await client.fetchScreenshotBlob(relativeUrl)
    expect(out).toBe(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}${relativeUrl}`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('uses absolute URL as-is when provided', async () => {
    const body = new Blob(['fake-png'], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValue(blobResponse(body))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const absoluteUrl = 'https://other.example.com/api/sessions/x/screenshots/f.png'
    await client.fetchScreenshotBlob(absoluteUrl)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(absoluteUrl)
  })

  it('throws ApiError on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', blob: () => Promise.resolve(new Blob()) })
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await expect(client.fetchScreenshotBlob('/api/sessions/x/screenshots/missing.png')).rejects.toThrow(ApiError)
  })
})

describe('ApiClient — push', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('getVapidKey unwraps data', async () => {
    const key: VapidPublicKey = { key: 'BXYZ' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: key }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out = await client.getVapidKey()
    expect(out).toEqual(key)
  })

  it('subscribePush POSTs the subscription', async () => {
    const sub: PushSubscriptionJSON = {
      endpoint: 'https://push.example.com/abc',
      expirationTime: null,
      keys: { p256dh: 'pk', auth: 'ak' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true, id: 'sub-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out = await client.subscribePush(sub)
    expect(out).toEqual({ ok: true, id: 'sub-1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/push-subscribe`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as PushSubscriptionJSON
    expect(body).toEqual(sub)
  })

  it('unsubscribePush DELETEs with endpoint body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const out = await client.unsubscribePush('https://push.example.com/abc')
    expect(out).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/push-subscribe`)
    expect(init.method).toBe('DELETE')
    const body = JSON.parse(init.body as string) as { endpoint: string }
    expect(body.endpoint).toBe('https://push.example.com/abc')
  })
})

describe('ApiClient — sendMessage with images', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends images array in POST body to /api/messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true, sessionId: 's-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const images = [{ mediaType: 'image/png', dataBase64: 'abc123' }]
    await client.sendMessage('look at this', 's-1', images)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/messages`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { text: string; sessionId: string; images: typeof images }
    expect(body.text).toBe('look at this')
    expect(body.sessionId).toBe('s-1')
    expect(body.images).toEqual(images)
  })

  it('omits images key when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true, sessionId: null } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    await client.sendMessage('hello', 's-1')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { images?: unknown }
    expect(body.images).toBeUndefined()
  })
})
