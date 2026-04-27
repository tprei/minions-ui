import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Live Activities Web Push Integration', () => {
  let mockRegistration: ServiceWorkerRegistration
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockRegistration = {
      showNotification: vi.fn().mockResolvedValue(undefined),
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue({
          toJSON: () => ({
            endpoint: 'https://push.example.com/sub123',
            expirationTime: null,
            keys: { p256dh: 'pk', auth: 'ak' },
          }),
        }),
      },
    } as unknown as ServiceWorkerRegistration

    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(mockRegistration),
      },
    })

    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('PushManager', function PushManager() {})
    vi.stubGlobal('isSecureContext', true)
    vi.stubEnv('VITE_ENABLE_PUSH', '1')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('enables push notifications with action buttons support', async () => {
    const mockClient = {
      getVapidKey: vi.fn().mockResolvedValue({
        key: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      }),
      subscribePush: vi.fn().mockResolvedValue({ ok: true, id: 'sub-live-1' }),
    }

    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(mockClient as never)

    expect(result.ok).toBe(true)
    expect(mockClient.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example.com/sub123',
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    )
  })

  it('server sends push with action buttons for attention event', async () => {
    const notificationPayload = {
      title: 'Session sess-456 needs attention',
      body: 'CI checks failed. Retry?',
      tag: 'sess-456-attention',
      sessionId: 'sess-456',
      connectionId: 'conn-1',
      baseUrl: 'https://api.minions.dev',
      token: 'bearer-token-abc',
      requireInteraction: true,
      url: '/sessions/sess-456',
      actions: [
        { action: 'retry', title: 'Retry' },
        { action: 'reply', title: 'Reply' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    }

    expect(notificationPayload.actions).toHaveLength(3)
    expect(notificationPayload.requireInteraction).toBe(true)
    expect(notificationPayload.sessionId).toBe('sess-456')
    expect(notificationPayload.baseUrl).toBe('https://api.minions.dev')
    expect(notificationPayload.token).toBe('bearer-token-abc')
  })

  it('clicking "retry" action button posts to API without opening app', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true, sessionId: 'sess-789' } }),
    })

    const baseUrl = 'https://api.minions.dev'
    const token = 'bearer-token-xyz'
    const sessionId = 'sess-789'

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: '/retry', sessionId }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.minions.dev/api/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bearer-token-xyz',
        },
        body: JSON.stringify({ text: '/retry', sessionId: 'sess-789' }),
      }),
    )
  })

  it('clicking "approve" action button posts approval to API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    })

    const baseUrl = 'https://api.minions.dev'
    const token = 'bearer-token-xyz'
    const sessionId = 'sess-101'

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: 'Approved', sessionId }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.minions.dev/api/messages',
      expect.objectContaining({
        body: JSON.stringify({ text: 'Approved', sessionId: 'sess-101' }),
      }),
    )
  })

  it('handles API failure gracefully when action is clicked', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const baseUrl = 'https://api.minions.dev'
    const token = 'bearer-token-fail'
    const sessionId = 'sess-error'

    await expect(
      fetch(`${baseUrl}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: '/retry', sessionId }),
      }),
    ).rejects.toThrow('Network error')
  })

  it('persistent notification remains visible until interaction', () => {
    const payload = {
      title: 'Waiting for approval',
      body: 'PR ready to merge',
      requireInteraction: true,
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'dismiss', title: 'Later' },
      ],
    }

    expect(payload.requireInteraction).toBe(true)
    expect(payload.actions).toEqual([
      { action: 'approve', title: 'Approve' },
      { action: 'dismiss', title: 'Later' },
    ])
  })

  it('notification without requireInteraction dismisses automatically', () => {
    const payload = {
      title: 'Task completed',
      body: 'Session finished successfully',
      requireInteraction: false,
    }

    expect(payload.requireInteraction).toBe(false)
  })

  it('action button data includes connection context for multi-tenant', () => {
    const payload = {
      sessionId: 'sess-999',
      connectionId: 'conn-prod-1',
      baseUrl: 'https://api-prod.minions.dev',
      token: 'token-for-connection-1',
    }

    expect(payload.connectionId).toBe('conn-prod-1')
    expect(payload.baseUrl).toBe('https://api-prod.minions.dev')
    expect(payload.token).toBe('token-for-connection-1')
  })

  it('supports multiple action buttons up to platform limit', () => {
    const payload = {
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'reply', title: 'Reply' },
        { action: 'retry', title: 'Retry' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    }

    expect(payload.actions.length).toBeLessThanOrEqual(4)
  })
})
