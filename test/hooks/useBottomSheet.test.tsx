import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useBottomSheet } from '../../src/hooks/useBottomSheet'

describe('useBottomSheet', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrateSpy,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 1000,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns required refs and handlers', () => {
    const { result } = renderHook(() => useBottomSheet({}))

    expect(result.current.containerRef).toBeDefined()
    expect(result.current.contentRef).toBeDefined()
    expect(typeof result.current.snapTo).toBe('function')
    expect(typeof result.current.handlePointerDown).toBe('function')
    expect(typeof result.current.handlePointerMove).toBe('function')
    expect(typeof result.current.handlePointerUp).toBe('function')
  })

  it('initializes with default snap point', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))
    expect(result.current.currentSnap).toBe('half')
  })

  it('initializes with peek as default when not specified', () => {
    const { result } = renderHook(() => useBottomSheet({}))
    expect(result.current.currentSnap).toBe('peek')
  })

  it('snaps to target position', () => {
    const onSnapChange = vi.fn()
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'peek', onSnapChange }))

    const container = document.createElement('div')
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.snapTo('half')
    })

    expect(result.current.currentSnap).toBe('half')
    expect(onSnapChange).toHaveBeenCalledWith('half')
    expect(container.style.height).toBe('500px')
  })

  it('snaps to full viewport', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'peek' }))

    const container = document.createElement('div')
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.snapTo('full')
    })

    expect(result.current.currentSnap).toBe('full')
    expect(container.style.height).toBe('920px')
  })

  it('handles drag to increase height', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'peek' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 150, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 300 }))
    })

    expect(container.style.height).toBeTruthy()
    const height = parseInt(container.style.height)
    expect(height).toBeGreaterThan(150)
  })

  it('handles drag to decrease height', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 500, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 300 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 400 }))
    })

    expect(container.style.height).toBeTruthy()
    const height = parseInt(container.style.height)
    expect(height).toBeLessThan(500)
  })

  it('snaps to nearest point on release', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'peek' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 150, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 200 }))
    })

    act(() => {
      result.current.handlePointerUp()
    })

    expect(result.current.currentSnap).toBe('half')
  })

  it('triggers haptic feedback when crossing snap points', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'peek' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 150, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 155 }))
    })

    expect(vibrateSpy).toHaveBeenCalled()
  })

  it('prevents scroll hijack when content is scrolled', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    const content = document.createElement('div')
    Object.defineProperty(content, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(content, 'clientHeight', { value: 500, writable: true })
    Object.defineProperty(content, 'scrollTop', { value: 100, writable: true })
    Object.defineProperty(content, 'contains', {
      value: (el: HTMLElement) => el === content,
      writable: true,
    })

    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })
    Object.defineProperty(result.current.contentRef, 'current', { value: content, writable: true })

    act(() => {
      const target = content
      const event = new PointerEvent('pointerdown', { clientY: 300 })
      Object.defineProperty(event, 'target', { value: target })
      result.current.handlePointerDown(event)
    })

    const initialHeight = container.style.height

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 400 }))
    })

    expect(container.style.height).toBe(initialHeight)
  })

  it('allows drag when content is at scroll top', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    const content = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 500, writable: true })
    Object.defineProperty(content, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(content, 'clientHeight', { value: 500, writable: true })
    Object.defineProperty(content, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(content, 'contains', {
      value: (el: HTMLElement) => el === content,
      writable: true,
    })

    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })
    Object.defineProperty(result.current.contentRef, 'current', { value: content, writable: true })

    act(() => {
      const target = content
      const event = new PointerEvent('pointerdown', { clientY: 300 })
      Object.defineProperty(event, 'target', { value: target })
      result.current.handlePointerDown(event)
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 400 }))
    })

    expect(container.style.height).toBeTruthy()
    const height = parseInt(container.style.height)
    expect(height).toBeLessThan(500)
  })

  it('does nothing when disabled', () => {
    const onSnapChange = vi.fn()
    const { result } = renderHook(() => useBottomSheet({ enabled: false, onSnapChange }))

    const container = document.createElement('div')
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 200 }))
    })

    act(() => {
      result.current.handlePointerUp()
    })

    expect(onSnapChange).not.toHaveBeenCalled()
    expect(container.style.height).toBeFalsy()
  })

  it('adjusts height on window resize', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      vi.runAllTimers()
    })

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(container.style.height).toBe('400px')
  })

  it('snaps to peek when dragged below half threshold', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 500, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 300 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerUp()
    })

    expect(result.current.currentSnap).toBe('peek')
  })

  it('snaps to full when dragged above half threshold', () => {
    const { result } = renderHook(() => useBottomSheet({ defaultSnap: 'half' }))

    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetHeight', { value: 500, writable: true })
    Object.defineProperty(result.current.containerRef, 'current', { value: container, writable: true })

    act(() => {
      result.current.handlePointerDown(new PointerEvent('pointerdown', { clientY: 500 }))
    })

    act(() => {
      result.current.handlePointerMove(new PointerEvent('pointermove', { clientY: 100 }))
    })

    act(() => {
      result.current.handlePointerUp()
    })

    expect(result.current.currentSnap).toBe('full')
  })
})
