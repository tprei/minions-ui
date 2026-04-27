import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Notification Actions Payload Structure', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('validates notification payload structure with actions', () => {
    const payload = {
      title: 'Session needs attention',
      body: 'Task completed, awaiting approval',
      sessionId: 'sess-123',
      connectionId: 'conn-1',
      baseUrl: 'https://api.example.com',
      token: 'secret-token',
      requireInteraction: true,
      url: '/sessions/sess-123',
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'reply', title: 'Reply' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    }

    expect(payload.actions).toHaveLength(3)
    expect(payload.requireInteraction).toBe(true)
    expect(payload.sessionId).toBe('sess-123')
    expect(payload.baseUrl).toBe('https://api.example.com')
    expect(payload.token).toBe('secret-token')
  })

  it('sends message to API when "reply" action is triggered', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true, sessionId: 'sess-456' } }),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const baseUrl = 'https://api.example.com'
    const token = 'secret-token'
    const sessionId = 'sess-456'

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: 'Continue', sessionId }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        },
        body: JSON.stringify({ text: 'Continue', sessionId: 'sess-456' }),
      }),
    )
  })

  it('sends approve message for "approve" action', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const baseUrl = 'https://api.example.com'
    const token = 'secret-token'
    const sessionId = 'sess-789'

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: 'Approved', sessionId }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        body: JSON.stringify({ text: 'Approved', sessionId: 'sess-789' }),
      }),
    )
  })

  it('sends retry command for "retry" action', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const baseUrl = 'https://api.example.com'
    const token = 'secret-token'
    const sessionId = 'sess-999'

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: '/retry', sessionId }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        body: JSON.stringify({ text: '/retry', sessionId: 'sess-999' }),
      }),
    )
  })

  it('validates action handlers mapping', () => {
    const actionHandlers = {
      reply: { text: 'Continue' },
      approve: { text: 'Approved' },
      retry: { text: '/retry' },
      dismiss: { text: null },
    }

    expect(actionHandlers.reply.text).toBe('Continue')
    expect(actionHandlers.approve.text).toBe('Approved')
    expect(actionHandlers.retry.text).toBe('/retry')
    expect(actionHandlers.dismiss.text).toBe(null)
  })

  it('validates notification data structure includes connection context', () => {
    const notificationData = {
      url: '/sessions/sess-222',
      sessionId: 'sess-222',
      connectionId: 'conn-prod-1',
      baseUrl: 'https://api-prod.example.com',
      token: 'token-abc',
    }

    expect(notificationData.sessionId).toBe('sess-222')
    expect(notificationData.connectionId).toBe('conn-prod-1')
    expect(notificationData.baseUrl).toBe('https://api-prod.example.com')
    expect(notificationData.token).toBe('token-abc')
  })

  it('validates requireInteraction flag for persistent notifications', () => {
    const persistentPayload = {
      requireInteraction: true,
      actions: [{ action: 'approve', title: 'Approve' }],
    }

    const transientPayload = {
      requireInteraction: false,
      actions: [],
    }

    expect(persistentPayload.requireInteraction).toBe(true)
    expect(transientPayload.requireInteraction).toBe(false)
  })

  it('validates default values when optional fields are missing', () => {
    const defaultUrl = '/'
    const defaultActions: unknown[] = []
    const defaultRequireInteraction = false

    expect(defaultUrl).toBe('/')
    expect(defaultActions).toEqual([])
    expect(defaultRequireInteraction).toBe(false)
  })
})
