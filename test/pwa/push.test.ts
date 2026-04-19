import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const NotificationStub = {
  permission: 'default' as NotificationPermission,
  requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission),
}

const PushManagerStub = function PushManager() {}

function setEnv(value: string | undefined) {
  if (value === undefined) vi.unstubAllEnvs()
  else vi.stubEnv('VITE_ENABLE_PUSH', value)
}

function stubBrowserGlobals() {
  vi.stubGlobal('Notification', NotificationStub)
  vi.stubGlobal('PushManager', PushManagerStub)
  vi.stubGlobal('isSecureContext', true)
}

beforeEach(() => {
  NotificationStub.permission = 'default'
  NotificationStub.requestPermission = vi.fn().mockResolvedValue('granted')
  setEnv('1')
  stubBrowserGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setEnv(undefined)
  vi.resetModules()
})

describe('isPushFlagEnabled', () => {
  it('returns true for "1", "true", "yes", "on"', async () => {
    const { isPushFlagEnabled } = await import('../../src/pwa/push')
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      setEnv(v)
      expect(isPushFlagEnabled()).toBe(true)
    }
  })

  it('returns false when undefined or off-like', async () => {
    const { isPushFlagEnabled } = await import('../../src/pwa/push')
    for (const v of [undefined, '', '0', 'false', 'no', 'off']) {
      setEnv(v)
      expect(isPushFlagEnabled()).toBe(false)
    }
  })
})

describe('detectPushSupport', () => {
  it('returns flag-disabled when env flag is off', async () => {
    setEnv('0')
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(detectPushSupport().kind).toBe('flag-disabled')
  })

  it('returns insecure-context when not secure', async () => {
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(
      detectPushSupport({
        isSecureContext: false,
        navigator: { serviceWorker: {} } as unknown as Navigator,
        Notification: NotificationStub,
        PushManager: PushManagerStub,
      } as unknown as typeof globalThis).kind,
    ).toBe('insecure-context')
  })

  it('returns no-service-worker when navigator lacks SW', async () => {
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(
      detectPushSupport({
        isSecureContext: true,
        navigator: {} as Navigator,
        Notification: NotificationStub,
        PushManager: PushManagerStub,
      } as unknown as typeof globalThis).kind,
    ).toBe('no-service-worker')
  })

  it('returns no-push-manager when window lacks PushManager', async () => {
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(
      detectPushSupport({
        isSecureContext: true,
        navigator: { serviceWorker: {} } as unknown as Navigator,
        Notification: NotificationStub,
      } as unknown as typeof globalThis).kind,
    ).toBe('no-push-manager')
  })

  it('returns no-notifications when window lacks Notification', async () => {
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(
      detectPushSupport({
        isSecureContext: true,
        navigator: { serviceWorker: {} } as unknown as Navigator,
        PushManager: PushManagerStub,
      } as unknown as typeof globalThis).kind,
    ).toBe('no-notifications')
  })

  it('returns supported when everything is in place', async () => {
    const { detectPushSupport } = await import('../../src/pwa/push')
    expect(
      detectPushSupport({
        isSecureContext: true,
        navigator: { serviceWorker: {} } as unknown as Navigator,
        Notification: NotificationStub,
        PushManager: PushManagerStub,
      } as unknown as typeof globalThis).kind,
    ).toBe('supported')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes a known base64url VAPID-style key', async () => {
    const { urlBase64ToUint8Array } = await import('../../src/pwa/push')
    const out = urlBase64ToUint8Array('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.byteLength).toBe(65)
    expect(out[0]).toBe(0x04)
  })

  it('handles base64url with - and _ and missing padding', async () => {
    const { urlBase64ToUint8Array } = await import('../../src/pwa/push')
    const standard = atob('Hi+/')
    const expected = Uint8Array.from(standard, (c) => c.charCodeAt(0))
    const out = urlBase64ToUint8Array('Hi-_')
    expect(out.byteLength).toBe(expected.byteLength)
    expect(Array.from(out)).toEqual(Array.from(expected))
  })

  it('throws on empty input', async () => {
    const { urlBase64ToUint8Array } = await import('../../src/pwa/push')
    expect(() => urlBase64ToUint8Array('')).toThrow(/empty/)
    expect(() => urlBase64ToUint8Array('   ')).toThrow(/empty/)
  })

  it('throws on invalid base64', async () => {
    const { urlBase64ToUint8Array } = await import('../../src/pwa/push')
    expect(() => urlBase64ToUint8Array('not*valid*chars')).toThrow(/base64url/)
  })
})

describe('toPushSubscriptionJSON', () => {
  it('normalizes a PushSubscription.toJSON()', async () => {
    const { toPushSubscriptionJSON } = await import('../../src/pwa/push')
    const sub = {
      toJSON: () => ({
        endpoint: 'https://push.example.com/abc',
        expirationTime: null,
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    } as unknown as PushSubscription
    expect(toPushSubscriptionJSON(sub)).toEqual({
      endpoint: 'https://push.example.com/abc',
      expirationTime: null,
      keys: { p256dh: 'pk', auth: 'ak' },
    })
  })

  it('throws on missing endpoint or keys', async () => {
    const { toPushSubscriptionJSON } = await import('../../src/pwa/push')
    expect(() =>
      toPushSubscriptionJSON({ toJSON: () => ({}) } as unknown as PushSubscription),
    ).toThrow(/endpoint/)
    expect(() =>
      toPushSubscriptionJSON({
        toJSON: () => ({ endpoint: 'x', keys: {} }),
      } as unknown as PushSubscription),
    ).toThrow(/keys/)
  })
})

describe('enablePush', () => {
  function makeRegistration({
    existing,
    subscribe,
  }: {
    existing?: unknown
    subscribe?: ReturnType<typeof vi.fn>
  } = {}) {
    return {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(existing ?? null),
        subscribe: subscribe ?? vi.fn().mockResolvedValue({
          toJSON: () => ({
            endpoint: 'https://push.example.com/new',
            expirationTime: null,
            keys: { p256dh: 'pk', auth: 'ak' },
          }),
        }),
      },
    }
  }

  function installServiceWorker(reg: ReturnType<typeof makeRegistration>) {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(reg as unknown as ServiceWorkerRegistration),
      },
    })
  }

  afterEach(() => {
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
  })

  function makeClient(overrides: Record<string, unknown> = {}) {
    return {
      getVapidKey: vi.fn().mockResolvedValue({ key: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM' }),
      subscribePush: vi.fn().mockResolvedValue({ ok: true, id: 'sub-1' }),
      unsubscribePush: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    }
  }

  it('returns unsupported when flag is disabled', async () => {
    setEnv('0')
    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(makeClient() as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported')
  })

  it('returns permission-denied when user denies', async () => {
    NotificationStub.permission = 'default'
    NotificationStub.requestPermission = vi.fn().mockResolvedValue('denied')
    const reg = makeRegistration()
    installServiceWorker(reg)
    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(makeClient() as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permission-denied')
  })

  it('returns permission-default when user dismisses', async () => {
    NotificationStub.permission = 'default'
    NotificationStub.requestPermission = vi.fn().mockResolvedValue('default')
    installServiceWorker(makeRegistration())
    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(makeClient() as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permission-default')
  })

  it('subscribes and POSTs JSON when permission is granted', async () => {
    NotificationStub.permission = 'granted'
    const reg = makeRegistration()
    installServiceWorker(reg)
    const client = makeClient()
    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(client as never)
    expect(result.ok).toBe(true)
    expect(client.getVapidKey).toHaveBeenCalled()
    expect(reg.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )
    expect(client.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example.com/new' }),
    )
  })

  it('replaces an existing subscription before subscribing', async () => {
    NotificationStub.permission = 'granted'
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const reg = makeRegistration({
      existing: {
        endpoint: 'https://push.example.com/old',
        unsubscribe,
        toJSON: () => ({
          endpoint: 'https://push.example.com/old',
          keys: { p256dh: 'pk', auth: 'ak' },
        }),
      },
    })
    installServiceWorker(reg)
    const { enablePush } = await import('../../src/pwa/push')
    await enablePush(makeClient() as never)
    expect(unsubscribe).toHaveBeenCalled()
    expect(reg.pushManager.subscribe).toHaveBeenCalled()
  })

  it('returns error when subscribe throws', async () => {
    NotificationStub.permission = 'granted'
    const reg = makeRegistration({
      subscribe: vi.fn().mockRejectedValue(new Error('boom')),
    })
    installServiceWorker(reg)
    const { enablePush } = await import('../../src/pwa/push')
    const result = await enablePush(makeClient() as never)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('error')
      expect(result.error).toContain('boom')
    }
  })
})

describe('disablePush', () => {
  function installSwReady(ready: Promise<unknown>) {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: { ready },
    })
  }

  afterEach(() => {
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('returns ok when no subscription exists', async () => {
    installSwReady(
      Promise.resolve({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
      } as unknown as ServiceWorkerRegistration),
    )
    const { disablePush } = await import('../../src/pwa/push')
    const client = { unsubscribePush: vi.fn() }
    const result = await disablePush(client as never)
    expect(result.ok).toBe(true)
    expect(client.unsubscribePush).not.toHaveBeenCalled()
  })

  it('calls server DELETE then subscription.unsubscribe', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const sub = {
      endpoint: 'https://push.example.com/abc',
      unsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    }
    installSwReady(
      Promise.resolve({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) },
      } as unknown as ServiceWorkerRegistration),
    )
    const { disablePush } = await import('../../src/pwa/push')
    const client = { unsubscribePush: vi.fn().mockResolvedValue({ ok: true }) }
    const result = await disablePush(client as never)
    expect(result.ok).toBe(true)
    expect(client.unsubscribePush).toHaveBeenCalledWith('https://push.example.com/abc')
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('still unsubscribes locally even if server DELETE fails', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const sub = {
      endpoint: 'https://push.example.com/abc',
      unsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
    }
    installSwReady(
      Promise.resolve({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) },
      } as unknown as ServiceWorkerRegistration),
    )
    const { disablePush } = await import('../../src/pwa/push')
    const client = { unsubscribePush: vi.fn().mockRejectedValue(new Error('500')) }
    const result = await disablePush(client as never)
    expect(result.ok).toBe(true)
    expect(unsubscribe).toHaveBeenCalled()
  })
})
