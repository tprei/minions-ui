import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('initializes to navigator.onLine', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const { useOnlineStatus } = await import('../../src/pwa/useOnlineStatus')
    expect(useOnlineStatus().value).toBe(true)
  })

  it('goes false on offline event', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const { useOnlineStatus } = await import('../../src/pwa/useOnlineStatus')
    const status = useOnlineStatus()
    window.dispatchEvent(new Event('offline'))
    expect(status.value).toBe(false)
  })

  it('goes true on online event after offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const { useOnlineStatus } = await import('../../src/pwa/useOnlineStatus')
    const status = useOnlineStatus()
    window.dispatchEvent(new Event('offline'))
    expect(status.value).toBe(false)
    window.dispatchEvent(new Event('online'))
    expect(status.value).toBe(true)
  })
})
