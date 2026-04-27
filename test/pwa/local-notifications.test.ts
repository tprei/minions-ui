import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('local-notifications', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports unsupported when Notification API is missing', async () => {
    vi.stubGlobal('Notification', undefined)
    const mod = await import('../../src/pwa/local-notifications')
    expect(mod.isLocalNotificationsSupported()).toBe(false)
    expect(mod.getLocalNotificationsPermission()).toBe('unsupported')
  })

  it('reports current Notification.permission when supported', async () => {
    const Notif = vi.fn() as unknown as typeof Notification
    ;(Notif as unknown as { permission: NotificationPermission }).permission = 'granted'
    vi.stubGlobal('Notification', Notif)
    const mod = await import('../../src/pwa/local-notifications')
    expect(mod.isLocalNotificationsSupported()).toBe(true)
    expect(mod.getLocalNotificationsPermission()).toBe('granted')
  })

  it('enableLocalNotifications requests permission and persists', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, { permission: 'default', requestPermission })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    const result = await mod.enableLocalNotifications()

    expect(result.ok).toBe(true)
    expect(result.permission).toBe('granted')
    expect(requestPermission).toHaveBeenCalled()
    expect(mod.isLocalNotificationsEnabled()).toBe(true)
    expect(localStorage.getItem('minions-ui:local-notifications-enabled:v1')).toBe('1')
  })

  it('does not enable when permission is denied', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, { permission: 'default', requestPermission })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    const result = await mod.enableLocalNotifications()
    expect(result.ok).toBe(false)
    expect(mod.isLocalNotificationsEnabled()).toBe(false)
  })

  it('disableLocalNotifications resets the persisted flag', async () => {
    localStorage.setItem('minions-ui:local-notifications-enabled:v1', '1')
    const requestPermission = vi.fn().mockResolvedValue('granted')
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, { permission: 'granted', requestPermission })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    expect(mod.isLocalNotificationsEnabled()).toBe(true)

    mod.disableLocalNotifications()
    expect(mod.isLocalNotificationsEnabled()).toBe(false)
    expect(localStorage.getItem('minions-ui:local-notifications-enabled:v1')).toBe('0')
  })

  it('showLocalNotification suppresses when document is visible', async () => {
    const ctor = vi.fn()
    const Notif = function (this: unknown, title: string, opts?: NotificationOptions) {
      ctor(title, opts)
      return this
    } as unknown as typeof Notification
    Object.assign(Notif, { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    await mod.enableLocalNotifications()

    const result = mod.showLocalNotification(
      { title: 'hi', body: 'world' },
      { documentVisible: true },
    )
    expect(result).toBeNull()
    expect(ctor).not.toHaveBeenCalled()
  })

  it('showLocalNotification fires when enabled, granted, and document hidden', async () => {
    const ctor = vi.fn()
    const Notif = function (this: unknown, title: string, opts?: NotificationOptions) {
      ctor(title, opts)
      return this
    } as unknown as typeof Notification
    Object.assign(Notif, { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    await mod.enableLocalNotifications()

    mod.showLocalNotification({ title: 'hi', body: 'world' }, { documentVisible: false })
    expect(ctor).toHaveBeenCalledWith('hi', expect.objectContaining({ body: 'world' }))
  })

  it('showLocalNotification suppresses when not enabled, even if hidden', async () => {
    const ctor = vi.fn()
    const Notif = function (this: unknown, title: string, opts?: NotificationOptions) {
      ctor(title, opts)
      return this
    } as unknown as typeof Notification
    Object.assign(Notif, { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    // do not enable

    const result = mod.showLocalNotification({ title: 'hi' }, { documentVisible: false })
    expect(result).toBeNull()
    expect(ctor).not.toHaveBeenCalled()
  })

  it('showLocalNotification suppresses when permission becomes not-granted', async () => {
    const ctor = vi.fn()
    const Notif = function (this: unknown, title: string, opts?: NotificationOptions) {
      ctor(title, opts)
      return this
    } as unknown as typeof Notification
    Object.assign(Notif, { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') })
    vi.stubGlobal('Notification', Notif)

    const mod = await import('../../src/pwa/local-notifications')
    await mod.enableLocalNotifications()

    // permission flips to denied behind our back
    Object.assign(Notif, { permission: 'denied' })

    const result = mod.showLocalNotification({ title: 'hi' }, { documentVisible: false })
    expect(result).toBeNull()
    expect(ctor).not.toHaveBeenCalled()
  })
})
