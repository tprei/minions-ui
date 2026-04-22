import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient, ApiError } from '../../src/api/client'
import type { ApiResponse } from '../../src/api/types'

describe('createApiClient', () => {
  const baseUrl = 'http://localhost:8080'
  const token = 'test-token'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('URL handling', () => {
    it('strips trailing slashes from baseUrl', () => {
      const client = createApiClient({ baseUrl: 'http://localhost:8080///', token })
      expect(client.baseUrl).toBe('http://localhost:8080')
    })

    it('preserves baseUrl without trailing slash', () => {
      const client = createApiClient({ baseUrl: 'http://localhost:8080', token })
      expect(client.baseUrl).toBe('http://localhost:8080')
    })

    it('encodes special characters in URL parameters', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))

      const client = createApiClient({ baseUrl, token })
      await client.getTranscript('session/with/slashes', 123)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('session%2Fwith%2Fslashes'),
        expect.any(Object),
      )
    })
  })

  describe('authentication headers', () => {
    it('includes Bearer token in Authorization header when token provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ data: { apiVersion: '1.0', libraryVersion: '1.0', features: [] } }),
            {
              status: 200,
            },
          ),
      )

      const client = createApiClient({ baseUrl, token: 'my-secret-token' })
      await client.getVersion()

      expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer my-secret-token',
        },
      })
    })

    it('omits Authorization header when token is empty', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ data: { apiVersion: '1.0', libraryVersion: '1.0', features: [] } }),
            {
              status: 200,
            },
          ),
      )

      const client = createApiClient({ baseUrl, token: '' })
      await client.getVersion()

      expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    })
  })

  describe('error handling', () => {
    it('throws ApiError with status and message on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            statusText: 'Not Found',
          }),
      )

      const client = createApiClient({ baseUrl, token })

      try {
        await client.getVersion()
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        expect((e as ApiError).status).toBe(404)
        expect((e as ApiError).message).toBe('Not Found')
      }
    })

    it('throws ApiError with statusText when error message is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: null }), {
            status: 500,
            statusText: 'Internal Server Error',
          }),
      )

      const client = createApiClient({ baseUrl, token })

      try {
        await client.getVersion()
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as ApiError).message).toBe('Internal Server Error')
      }
    })

    it('throws ApiError on body.error even when HTTP status is 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify({ error: 'Invalid token' }), { status: 200 }),
      )

      const client = createApiClient({ baseUrl, token })

      try {
        await client.getVersion()
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as ApiError).message).toBe('Invalid token')
      }
    })

    it('preserves error details in ApiError', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: 'Unauthorized: Token expired' }), {
            status: 401,
            statusText: 'Unauthorized',
          }),
      )

      const client = createApiClient({ baseUrl, token })

      try {
        await client.getSessions()
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        expect((e as ApiError).status).toBe(401)
        expect((e as ApiError).message).toBe('Unauthorized: Token expired')
        expect((e as ApiError).name).toBe('ApiError')
      }
    })
  })

  describe('HTTP methods', () => {
    it('sends GET request for getSessions', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))

      const client = createApiClient({ baseUrl, token })
      await client.getSessions()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/sessions',
        expect.objectContaining({ method: undefined }),
      )
    })

    it('sends POST request for sendCommand', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.sendCommand({ type: 'continue', sessionId: '123' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/commands',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ type: 'continue', sessionId: '123' }),
        }),
      )
    })

    it('sends PATCH request for patchRuntimeConfig', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(JSON.stringify({ data: { overrides: {} } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.patchRuntimeConfig({ model: 'sonnet' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/config/runtime',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ model: 'sonnet' }),
        }),
      )
    })

    it('sends DELETE request for unsubscribePush', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.unsubscribePush('https://example.com/endpoint')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/push-subscribe',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ endpoint: 'https://example.com/endpoint' }),
        }),
      )
    })
  })

  describe('getDiff', () => {
    it('transforms wire format to client format with computed stats', async () => {
      const wireDiff = {
        head: 'feature-branch',
        base: 'main',
        patch:
          'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n+added line\n-removed line',
        truncated: false,
      }

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify({ data: wireDiff }), { status: 200 }),
      )

      const client = createApiClient({ baseUrl, token })
      const result = await client.getDiff('session-123')

      expect(result).toEqual({
        branch: 'feature-branch',
        baseBranch: 'main',
        patch: wireDiff.patch,
        truncated: false,
        stats: { filesChanged: 1, insertions: 1, deletions: 1 },
      })
    })
  })

  describe('fetchScreenshotBlob', () => {
    it('fetches relative URL by prepending baseUrl', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(new Blob(['data'], { type: 'image/png' }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.fetchScreenshotBlob('/screenshots/123.png')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/screenshots/123.png',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      )
    })

    it('fetches absolute URL directly', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(new Blob(['data'], { type: 'image/png' }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.fetchScreenshotBlob('https://cdn.example.com/screenshot.png')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://cdn.example.com/screenshot.png',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      )
    })

    it('throws ApiError on failed blob fetch', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(null, { status: 404, statusText: 'Image not found' }),
      )

      const client = createApiClient({ baseUrl, token })

      await expect(client.fetchScreenshotBlob('/screenshots/missing.png')).rejects.toThrow(ApiError)
      await expect(client.fetchScreenshotBlob('/screenshots/missing.png')).rejects.toThrow(
        'Image not found',
      )
    })

    it('omits Authorization header when token is empty', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(new Blob(['data'], { type: 'image/png' }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token: '' })
      await client.fetchScreenshotBlob('/screenshots/123.png')

      expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
        headers: {},
      })
    })
  })

  describe('getTranscript', () => {
    it('fetches transcript without query parameter when afterSeq is undefined', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: { messages: [], nextSeq: 0 } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.getTranscript('session-123')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/sessions/session-123/transcript',
        expect.any(Object),
      )
    })

    it('includes after query parameter when afterSeq is provided', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: { messages: [], nextSeq: 10 } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.getTranscript('session-123', 5)

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/sessions/session-123/transcript?after=5',
        expect.any(Object),
      )
    })
  })

  describe('sendMessage', () => {
    it('sends message with text only', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: { ok: true, sessionId: '123' } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.sendMessage('Hello world')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/api/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Hello world', sessionId: undefined, images: undefined }),
        }),
      )
    })

    it('sends message with sessionId', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: { ok: true, sessionId: '123' } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      await client.sendMessage('Continue', '123')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: 'Continue', sessionId: '123', images: undefined }),
        }),
      )
    })

    it('sends message with images', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: { ok: true, sessionId: '123' } }), { status: 200 }),
        )

      const client = createApiClient({ baseUrl, token })
      const images = [{ mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }]
      await client.sendMessage('Look at this', '123', images)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: 'Look at this', sessionId: '123', images }),
        }),
      )
    })
  })
})
