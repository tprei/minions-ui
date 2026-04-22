import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useMediaQuery } from '../../src/hooks/useMediaQuery'

class MockMediaQueryList {
  matches: boolean
  media: string
  private listeners: Array<(e: MediaQueryListEvent) => void> = []

  constructor(query: string, matches: boolean) {
    this.media = query
    this.matches = matches
  }

  addEventListener(event: 'change', handler: (e: MediaQueryListEvent) => void) {
    if (event === 'change') {
      this.listeners.push(handler)
    }
  }

  removeEventListener(event: 'change', handler: (e: MediaQueryListEvent) => void) {
    if (event === 'change') {
      this.listeners = this.listeners.filter((h) => h !== handler)
    }
  }

  triggerChange(matches: boolean) {
    this.matches = matches
    const event = new Event('change') as MediaQueryListEvent
    Object.defineProperty(event, 'matches', { value: matches })
    Object.defineProperty(event, 'media', { value: this.media })
    this.listeners.forEach((handler) => handler(event))
  }
}

describe('useMediaQuery', () => {
  let mockMediaQueryLists: Map<string, MockMediaQueryList>

  beforeEach(() => {
    mockMediaQueryLists = new Map()

    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      if (!mockMediaQueryLists.has(query)) {
        mockMediaQueryLists.set(query, new MockMediaQueryList(query, false))
      }
      return mockMediaQueryLists.get(query) as unknown as MediaQueryList
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns initial match state', () => {
    mockMediaQueryLists.set(
      '(min-width: 768px)',
      new MockMediaQueryList('(min-width: 768px)', true),
    )

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current.value).toBe(true)
  })

  it('returns false when media query does not match', () => {
    mockMediaQueryLists.set(
      '(max-width: 500px)',
      new MockMediaQueryList('(max-width: 500px)', false),
    )

    const { result } = renderHook(() => useMediaQuery('(max-width: 500px)'))

    expect(result.current.value).toBe(false)
  })

  it('updates when media query match changes', () => {
    const query = '(min-width: 768px)'
    const mql = new MockMediaQueryList(query, false)
    mockMediaQueryLists.set(query, mql)

    const { result } = renderHook(() => useMediaQuery(query))

    expect(result.current.value).toBe(false)

    act(() => {
      mql.triggerChange(true)
    })

    expect(result.current.value).toBe(true)
  })

  it('updates when media query stops matching', () => {
    const query = '(orientation: landscape)'
    const mql = new MockMediaQueryList(query, true)
    mockMediaQueryLists.set(query, mql)

    const { result } = renderHook(() => useMediaQuery(query))

    expect(result.current.value).toBe(true)

    act(() => {
      mql.triggerChange(false)
    })

    expect(result.current.value).toBe(false)
  })

  it('cleans up event listener on unmount', () => {
    const query = '(min-width: 1024px)'
    const mql = new MockMediaQueryList(query, false)
    mockMediaQueryLists.set(query, mql)
    const removeEventListenerSpy = vi.spyOn(mql, 'removeEventListener')

    const { unmount } = renderHook(() => useMediaQuery(query))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('updates listener when query changes', () => {
    const query1 = '(min-width: 768px)'
    const query2 = '(max-width: 768px)'
    const mql1 = new MockMediaQueryList(query1, true)
    const mql2 = new MockMediaQueryList(query2, false)
    mockMediaQueryLists.set(query1, mql1)
    mockMediaQueryLists.set(query2, mql2)

    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: query1 },
    })

    expect(result.current.value).toBe(true)

    rerender({ q: query2 })

    expect(result.current.value).toBe(false)
  })

  it('handles SSR environment gracefully', () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
    })

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current.value).toBe(false)

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    })
  })

  it('supports dark mode media query', () => {
    const query = '(prefers-color-scheme: dark)'
    const mql = new MockMediaQueryList(query, true)
    mockMediaQueryLists.set(query, mql)

    const { result } = renderHook(() => useMediaQuery(query))

    expect(result.current.value).toBe(true)

    act(() => {
      mql.triggerChange(false)
    })

    expect(result.current.value).toBe(false)
  })

  it('supports complex media queries', () => {
    const query = '(min-width: 768px) and (max-width: 1024px)'
    const mql = new MockMediaQueryList(query, true)
    mockMediaQueryLists.set(query, mql)

    const { result } = renderHook(() => useMediaQuery(query))

    expect(result.current.value).toBe(true)
  })
})
