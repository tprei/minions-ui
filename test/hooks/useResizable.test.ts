import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useResizable } from '../../src/hooks/useResizable'

describe('useResizable', () => {
  let localStorageMock: Map<string, string>

  beforeEach(() => {
    localStorageMock = new Map()

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => localStorageMock.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageMock.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          localStorageMock.delete(key)
        }),
      },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns default width when no stored value exists', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(300)
  })

  it('loads width from localStorage', () => {
    localStorageMock.set('test-width', '450')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(450)
  })

  it('clamps stored width to min constraint', () => {
    localStorageMock.set('test-width', '100')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(200)
  })

  it('clamps stored width to max constraint', () => {
    localStorageMock.set('test-width', '800')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(600)
  })

  it('uses default width for invalid stored values', () => {
    localStorageMock.set('test-width', 'not-a-number')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(300)
  })

  it('uses default width for empty stored values', () => {
    localStorageMock.set('test-width', '')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(300)
  })

  it('handles mouse drag to increase width', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 350 })
    act(() => {
      window.dispatchEvent(mouseMoveEvent)
    })

    expect(result.current.width).toBe(350)
  })

  it('handles mouse drag to decrease width', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 250 })
    act(() => {
      window.dispatchEvent(mouseMoveEvent)
    })

    expect(result.current.width).toBe(250)
  })

  it('clamps dragged width to min boundary', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 50 })
    act(() => {
      window.dispatchEvent(mouseMoveEvent)
    })

    expect(result.current.width).toBe(200)
  })

  it('clamps dragged width to max boundary', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 1000 })
    act(() => {
      window.dispatchEvent(mouseMoveEvent)
    })

    expect(result.current.width).toBe(600)
  })

  it('saves width to localStorage on mouseup', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 400 })
    act(() => {
      window.dispatchEvent(mouseMoveEvent)
    })

    const mouseUpEvent = new MouseEvent('mouseup')
    act(() => {
      window.dispatchEvent(mouseUpEvent)
    })

    expect(localStorage.setItem).toHaveBeenCalledWith('test-width', '400')
  })

  it('handles touch events', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const touchStartEvent = new TouchEvent('touchstart', {
      touches: [{ clientX: 300 } as Touch],
    })
    act(() => {
      result.current.onHandleDown(touchStartEvent)
    })

    const touchMoveEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 350 } as Touch],
    })
    act(() => {
      window.dispatchEvent(touchMoveEvent)
    })

    expect(result.current.width).toBe(350)
  })

  it('saves on touchend', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const touchStartEvent = new TouchEvent('touchstart', {
      touches: [{ clientX: 300 } as Touch],
    })
    act(() => {
      result.current.onHandleDown(touchStartEvent)
    })

    const touchMoveEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 400 } as Touch],
    })
    act(() => {
      window.dispatchEvent(touchMoveEvent)
    })

    const touchEndEvent = new TouchEvent('touchend')
    act(() => {
      window.dispatchEvent(touchEndEvent)
    })

    expect(localStorage.setItem).toHaveBeenCalledWith('test-width', '400')
  })

  it('stops dragging on touchcancel', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const touchStartEvent = new TouchEvent('touchstart', {
      touches: [{ clientX: 300 } as Touch],
    })
    act(() => {
      result.current.onHandleDown(touchStartEvent)
    })

    const touchCancelEvent = new TouchEvent('touchcancel')
    act(() => {
      window.dispatchEvent(touchCancelEvent)
    })

    const touchMoveEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 400 } as Touch],
    })
    act(() => {
      window.dispatchEvent(touchMoveEvent)
    })

    expect(result.current.width).toBe(300)
  })

  it('resets width to default and clears localStorage', () => {
    localStorageMock.set('test-width', '450')

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(result.current.width).toBe(450)

    act(() => {
      result.current.reset()
    })

    expect(result.current.width).toBe(300)
    expect(localStorage.removeItem).toHaveBeenCalledWith('test-width')
  })

  it('prevents default on handle down to avoid text selection', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    const preventDefaultSpy = vi.spyOn(mouseDownEvent, 'preventDefault')

    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  it('handles localStorage errors gracefully on save', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    const mouseDownEvent = new MouseEvent('mousedown', { clientX: 300 })
    act(() => {
      result.current.onHandleDown(mouseDownEvent)
    })

    const mouseUpEvent = new MouseEvent('mouseup')
    expect(() => {
      act(() => {
        window.dispatchEvent(mouseUpEvent)
      })
    }).not.toThrow()
  })

  it('handles localStorage errors gracefully on reset', () => {
    vi.mocked(localStorage.removeItem).mockImplementation(() => {
      throw new Error('Storage error')
    })

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-width',
        defaultWidth: 300,
        min: 200,
        max: 600,
      }),
    )

    expect(() => {
      act(() => {
        result.current.reset()
      })
    }).not.toThrow()
  })
})
