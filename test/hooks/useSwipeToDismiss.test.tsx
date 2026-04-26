import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useSwipeToDismiss } from '../../src/hooks/useSwipeToDismiss'

describe('useSwipeToDismiss', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrateSpy,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns containerRef and event handlers', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    expect(result.current.containerRef).toBeDefined()
    expect(typeof result.current.handlePointerDown).toBe('function')
    expect(typeof result.current.handlePointerMove).toBe('function')
    expect(typeof result.current.handlePointerUp).toBe('function')
  })

  it('does not call onDismiss for small swipe distance', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    const downEvent = new PointerEvent('pointerdown', { clientY: 100 })
    const moveEvent = new PointerEvent('pointermove', { clientY: 150 })

    act(() => {
      result.current.handlePointerDown(downEvent)
      result.current.handlePointerMove(moveEvent)
      result.current.handlePointerUp()
    })

    act(() => {
      vi.runAllTimers()
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('calls onDismiss for large swipe distance', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    const downEvent = new PointerEvent('pointerdown', { clientY: 100 })
    const moveEvent = new PointerEvent('pointermove', { clientY: 250 })

    act(() => {
      result.current.handlePointerDown(downEvent)
      result.current.handlePointerMove(moveEvent)
      result.current.handlePointerUp()
    })

    act(() => {
      vi.runAllTimers()
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('triggers haptic feedback at threshold', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    const container = document.createElement('div')
    if (result.current.containerRef.current === null) {
      Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })
    }

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 100 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 170 }))
    })

    expect(vibrateSpy).toHaveBeenCalledWith(10)
  })

  it('does not trigger haptic feedback below threshold', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    const container = document.createElement('div')
    if (result.current.containerRef.current === null) {
      Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })
    }

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 100 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 150 }))
    })

    expect(vibrateSpy).not.toHaveBeenCalled()
  })

  it('ignores upward swipes', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }))

    const downEvent = new PointerEvent('pointerdown', { clientY: 200 })
    const moveEvent = new PointerEvent('pointermove', { clientY: 100 })

    act(() => {
      result.current.handlePointerDown(downEvent)
      result.current.handlePointerMove(moveEvent)
      result.current.handlePointerUp()
    })

    expect(vibrateSpy).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss, enabled: false }))

    const downEvent = new PointerEvent('pointerdown', { clientY: 100 })
    const moveEvent = new PointerEvent('pointermove', { clientY: 250 })

    act(() => {
      result.current.handlePointerDown(downEvent)
      result.current.handlePointerMove(moveEvent)
      result.current.handlePointerUp()
    })

    act(() => {
      vi.runAllTimers()
    })

    expect(vibrateSpy).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
