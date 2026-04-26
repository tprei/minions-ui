import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
}))

vi.mock('workbox-routing', () => ({
  registerRoute: vi.fn(),
  NavigationRoute: vi.fn(),
}))

const mockSelf = {
  __WB_MANIFEST: [],
  registration: {
    showNotification: vi.fn(),
  },
  clients: {
    matchAll: vi.fn(),
    openWindow: vi.fn(),
  },
  addEventListener: vi.fn(),
  skipWaiting: vi.fn(),
}

vi.stubGlobal('self', mockSelf)

describe('Service Worker notification actions', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('sends /approve command when approve action is clicked', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })

    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'approve',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          token: 'test-token',
          sessionId: 'session-123',
          url: '/sessions/test-slug',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({ text: '/approve', sessionId: 'session-123' }),
      }),
    )
  })

  it('sends /reject command when reject action is clicked', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })

    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'reject',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          token: 'test-token',
          sessionId: 'session-456',
          url: '/sessions/test-slug',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '/reject', sessionId: 'session-456' }),
      }),
    )
  })

  it('sends /continue command when continue action is clicked', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })

    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'continue',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          token: 'test-token',
          sessionId: 'session-789',
          url: '/sessions/test-slug',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '/continue', sessionId: 'session-789' }),
      }),
    )
  })

  it('does nothing when baseUrl is missing', async () => {
    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'approve',
      notification: {
        close: vi.fn(),
        data: {
          token: 'test-token',
          sessionId: 'session-123',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does nothing when token is missing', async () => {
    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'approve',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          sessionId: 'session-123',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does nothing when sessionId is missing', async () => {
    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: 'approve',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          token: 'test-token',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does nothing when action is empty', async () => {
    const event = new Event('notificationclick') as NotificationEvent
    Object.assign(event, {
      action: '',
      notification: {
        close: vi.fn(),
        data: {
          baseUrl: 'https://api.example.com',
          token: 'test-token',
          sessionId: 'session-123',
        },
      },
    })

    const { handleNotificationAction } = await import('../../src/sw')
    await handleNotificationAction(event)

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
