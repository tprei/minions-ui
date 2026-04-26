import { renderHook, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBottomSheetSnap } from '../../src/hooks/useBottomSheetSnap'

describe('useBottomSheetSnap', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with peek snap point by default', () => {
    const { result } = renderHook(() => useBottomSheetSnap({ enabled: true }))
    expect(result.current.currentSnap).toBe('peek')
  })

  it('initializes with custom snap point', () => {
    const { result } = renderHook(() => useBottomSheetSnap({ enabled: true, initialSnap: 'half' }))
    expect(result.current.currentSnap).toBe('half')
  })

  it('returns elementRef', () => {
    const { result } = renderHook(() => useBottomSheetSnap())
    expect(result.current.elementRef).toBeDefined()
    expect(result.current.elementRef.current).toBeNull()
  })

  it('provides snapTo function', () => {
    const { result } = renderHook(() => useBottomSheetSnap())
    expect(typeof result.current.snapTo).toBe('function')
  })

  it('snapTo changes current snap point', async () => {
    const onSnapChange = vi.fn()
    const { result } = renderHook(() =>
      useBottomSheetSnap({ enabled: true, initialSnap: 'peek', onSnapChange }),
    )

    const mockElement = document.createElement('div')
    document.body.appendChild(mockElement)
    result.current.elementRef.current = mockElement

    await act(async () => {
      result.current.snapTo('half')
    })

    expect(result.current.currentSnap).toBe('half')
    expect(onSnapChange).toHaveBeenCalledWith('half')

    document.body.removeChild(mockElement)
  })

  it('snapTo sets element height', () => {
    const { result } = renderHook(() => useBottomSheetSnap({ enabled: true }))

    const mockElement = document.createElement('div')
    result.current.elementRef.current = mockElement

    act(() => {
      result.current.snapTo('half')
    })

    expect(mockElement.style.height).toBe('500px')
  })

  it('calculates correct heights for snap points', () => {
    const { result } = renderHook(() => useBottomSheetSnap({ enabled: true }))

    const mockElement = document.createElement('div')
    result.current.elementRef.current = mockElement

    act(() => {
      result.current.snapTo('peek')
    })
    expect(mockElement.style.height).toBe('250px')

    act(() => {
      result.current.snapTo('half')
    })
    expect(mockElement.style.height).toBe('500px')

    act(() => {
      result.current.snapTo('full')
    })
    expect(mockElement.style.height).toBe('900px')
  })

  it('does not set height when element is not attached', () => {
    const { result } = renderHook(() => useBottomSheetSnap({ enabled: true }))

    expect(() => {
      act(() => {
        result.current.snapTo('half')
      })
    }).not.toThrow()
  })

  it('respects enabled flag', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useBottomSheetSnap({ enabled, initialSnap: 'peek' }),
      { initialProps: { enabled: false } },
    )

    const mockElement = document.createElement('div')
    result.current.elementRef.current = mockElement

    rerender({ enabled: true })

    expect(mockElement.style.height).toBeTruthy()
  })
})
