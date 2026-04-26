import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/preact'
import { useHaptics } from '../../src/hooks/useHaptics'

describe('useHaptics', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      configurable: true,
      value: vibrateSpy,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns supported true when navigator.vibrate exists', () => {
    const { result } = renderHook(() => useHaptics())
    expect(result.current.supported).toBe(true)
  })

  it('returns supported false when navigator.vibrate does not exist', () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
    delete (navigator as { vibrate?: unknown }).vibrate
    const { result } = renderHook(() => useHaptics())
    expect(result.current.supported).toBe(false)
    if (desc) {
      Object.defineProperty(navigator, 'vibrate', desc)
    }
  })

  it('vibrates with light pattern (10ms)', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('light')
    expect(vibrateSpy).toHaveBeenCalledWith(10)
  })

  it('vibrates with medium pattern (20ms)', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('medium')
    expect(vibrateSpy).toHaveBeenCalledWith(20)
  })

  it('vibrates with heavy pattern (50ms)', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('heavy')
    expect(vibrateSpy).toHaveBeenCalledWith(50)
  })

  it('vibrates with success pattern (array)', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('success')
    expect(vibrateSpy).toHaveBeenCalledWith([10, 50, 10])
  })

  it('vibrates with error pattern (array)', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('error')
    expect(vibrateSpy).toHaveBeenCalledWith([50, 100, 50])
  })

  it('defaults to medium when no pattern specified', () => {
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate()
    expect(vibrateSpy).toHaveBeenCalledWith(20)
  })

  it('does nothing when navigator.vibrate does not exist', () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
    delete (navigator as { vibrate?: unknown }).vibrate
    const { result } = renderHook(() => useHaptics())
    result.current.vibrate('heavy')
    if (desc) {
      Object.defineProperty(navigator, 'vibrate', desc)
    }
  })
})
