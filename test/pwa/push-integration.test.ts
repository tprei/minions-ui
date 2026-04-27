import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ApiClient } from '../../src/api/client'

const NotificationStub = {
  permission: 'default' as NotificationPermission,
  requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission),
}

const PushManagerStub = function PushManager() {}

function stubBrowserGlobals() {
  vi.stubGlobal('Notification', NotificationStub)
  vi.stubGlobal('PushManager', PushManagerStub)
  vi.stubGlobal('isSecureContext', true)
}

function installServiceWorker(registration: ServiceWorkerRegistration) {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
    },
  })
}

beforeEach(() => {
  NotificationStub.permission = 'default'
  NotificationStub.requestPermission = vi.fn().mockResolvedValue('granted')
  vi.stubEnv('VITE_ENABLE_PUSH', '1')
  stubBrowserGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('Web Push Integration', () => {
  it('complete flow: detect support → request permission → subscribe → send to server', async () => {
    const subscribeMock = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: 'https://push.example.com/abc123',
        expirationTime: null,
        keys: { p256dh: 'test-pk', auth: 'test-ak' },
      }),
    })

    installServiceWorker({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: subscribeMock,
      },
    } as unknown as ServiceWorkerRegistration)

    const mockClient: Partial<ApiClient> = {
      getVapidKey: vi.fn().mockResolvedValue({
        key: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      }),
      subscribePush: vi.fn().mockResolvedValue({ ok: true, id: 'sub-xyz' }),
    }

    const { detectPushSupport, enablePush } = await import('../../src/pwa/push')

    const support = detectPushSupport()
    expect(support.kind).toBe('supported')

    NotificationStub.permission = 'granted'
    const result = await enablePush(mockClient as ApiClient)

    expect(result.ok).toBe(true)
    expect(mockClient.getVapidKey).toHaveBeenCalled()
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    )
    expect(mockClient.subscribePush).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/abc123',
      expirationTime: null,
      keys: { p256dh: 'test-pk', auth: 'test-ak' },
    })
  })

  it('handles permission denial gracefully', async () => {
    installServiceWorker({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn(),
      },
    } as unknown as ServiceWorkerRegistration)

    NotificationStub.permission = 'default'
    NotificationStub.requestPermission = vi.fn().mockResolvedValue('denied')

    const mockClient: Partial<ApiClient> = {
      getVapidKey: vi.fn(),
      subscribePush: vi.fn(),
    }

    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(mockClient as ApiClient)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('permission-denied')
    }
    expect(mockClient.getVapidKey).not.toHaveBeenCalled()
    expect(mockClient.subscribePush).not.toHaveBeenCalled()
  })

  it('replaces existing subscription before creating new one', async () => {
    const oldUnsubscribe = vi.fn().mockResolvedValue(true)
    const existingSub = {
      endpoint: 'https://push.example.com/old',
      unsubscribe: oldUnsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example.com/old',
        keys: { p256dh: 'old-pk', auth: 'old-ak' },
      }),
    }

    const newSubMock = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: 'https://push.example.com/new',
        expirationTime: null,
        keys: { p256dh: 'new-pk', auth: 'new-ak' },
      }),
    })

    installServiceWorker({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(existingSub),
        subscribe: newSubMock,
      },
    } as unknown as ServiceWorkerRegistration)

    const mockClient: Partial<ApiClient> = {
      getVapidKey: vi.fn().mockResolvedValue({
        key: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      }),
      subscribePush: vi.fn().mockResolvedValue({ ok: true, id: 'sub-new' }),
    }

    NotificationStub.permission = 'granted'

    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(mockClient as ApiClient)

    expect(result.ok).toBe(true)
    expect(oldUnsubscribe).toHaveBeenCalled()
    expect(newSubMock).toHaveBeenCalled()
    expect(mockClient.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example.com/new',
      }),
    )
  })

  it('unsubscribe flow: server DELETE → client unsubscribe', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const sub = {
      endpoint: 'https://push.example.com/current',
      unsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example.com/current',
        expirationTime: null,
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    }

    installServiceWorker({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(sub),
      },
    } as unknown as ServiceWorkerRegistration)

    const mockClient: Partial<ApiClient> = {
      unsubscribePush: vi.fn().mockResolvedValue({ ok: true }),
    }

    const { disablePush } = await import('../../src/pwa/push')
    const result = await disablePush(mockClient as ApiClient)

    expect(result.ok).toBe(true)
    expect(mockClient.unsubscribePush).toHaveBeenCalledWith('https://push.example.com/current')
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('continues local unsubscribe even if server DELETE fails', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const sub = {
      endpoint: 'https://push.example.com/current',
      unsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example.com/current',
        expirationTime: null,
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    }

    installServiceWorker({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(sub),
      },
    } as unknown as ServiceWorkerRegistration)

    const mockClient: Partial<ApiClient> = {
      unsubscribePush: vi.fn().mockRejectedValue(new Error('Network error')),
    }

    const { disablePush } = await import('../../src/pwa/push')
    const result = await disablePush(mockClient as ApiClient)

    expect(result.ok).toBe(true)
    expect(unsubscribe).toHaveBeenCalled()
  })
})
