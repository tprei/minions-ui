import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useTheme / setTheme', () => {
  let matchMediaListeners: Array<(e: { matches: boolean }) => void> = []
  let systemDark = false

  beforeEach(() => {
    matchMediaListeners = []
    systemDark = false

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        get matches() {
          return systemDark
        },
        addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
          matchMediaListeners.push(cb)
        }),
        removeEventListener: vi.fn(),
      })),
    })

    localStorage.clear()
    document.documentElement.dataset.theme = ''
    document.documentElement.classList.remove('dark')

    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to system preference (light)', async () => {
    systemDark = false
    const { useTheme } = await import('../../src/hooks/useTheme')
    const theme = useTheme()
    expect(theme.value).toBe('light')
  })

  it('defaults to system preference (dark)', async () => {
    systemDark = true
    const { useTheme } = await import('../../src/hooks/useTheme')
    const theme = useTheme()
    expect(theme.value).toBe('dark')
  })

  it('setTheme light updates signal and document', async () => {
    const { useTheme, setTheme } = await import('../../src/hooks/useTheme')
    const theme = useTheme()
    setTheme('light')
    expect(theme.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('setTheme dark updates signal and document', async () => {
    const { useTheme, setTheme } = await import('../../src/hooks/useTheme')
    const theme = useTheme()
    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setTheme persists to localStorage', async () => {
    const { setTheme } = await import('../../src/hooks/useTheme')
    setTheme('dark')
    expect(localStorage.getItem('minions-ui:theme')).toBe('dark')
  })

  it('setTheme system removes localStorage entry', async () => {
    localStorage.setItem('minions-ui:theme', 'dark')
    const { setTheme } = await import('../../src/hooks/useTheme')
    setTheme('system')
    expect(localStorage.getItem('minions-ui:theme')).toBeNull()
  })

  it('returns singleton signal', async () => {
    const { useTheme } = await import('../../src/hooks/useTheme')
    const a = useTheme()
    const b = useTheme()
    expect(a).toBe(b)
  })
})
