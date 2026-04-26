import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/preact'
import { useSwipeToDismiss } from '../../src/hooks/useSwipeToDismiss'

function TestComponent({
  onDismiss,
  threshold,
  enabled = true,
}: {
  onDismiss: () => void
  threshold?: number
  enabled?: boolean
}) {
  const ref = useSwipeToDismiss<HTMLDivElement>({ onDismiss, threshold, enabled })
  return <div ref={ref} data-testid="swipeable" />
}

describe('useSwipeToDismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('attaches event listeners to the element', () => {
    const onDismiss = vi.fn()
    render(<TestComponent onDismiss={onDismiss} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement
    expect(el).toBeTruthy()
  })

  it('triggers onDismiss when swiped down beyond threshold', () => {
    const onDismiss = vi.fn()
    const threshold = 100
    render(<TestComponent onDismiss={onDismiss} threshold={threshold} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 250 } as Touch],
    })
    const touchEnd = new TouchEvent('touchend', {
      touches: [],
    })

    el.dispatchEvent(touchStart)
    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchEnd)

    expect(el.style.transform).toBe('translateY(100%)')
    vi.advanceTimersByTime(300)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('snaps back when swipe does not exceed threshold', () => {
    const onDismiss = vi.fn()
    const threshold = 150
    render(<TestComponent onDismiss={onDismiss} threshold={threshold} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
    })

    el.dispatchEvent(touchStart)

    vi.advanceTimersByTime(200)

    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 180 } as Touch],
    })
    const touchEnd = new TouchEvent('touchend', {
      touches: [],
    })

    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchEnd)

    expect(el.style.transform).toBe('translateY(0)')
    vi.advanceTimersByTime(300)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('triggers onDismiss with high velocity even below threshold', () => {
    const onDismiss = vi.fn()
    const threshold = 150
    render(<TestComponent onDismiss={onDismiss} threshold={threshold} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
    })

    el.dispatchEvent(touchStart)

    vi.advanceTimersByTime(50)

    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 150 } as Touch],
    })
    const touchEnd = new TouchEvent('touchend', {
      touches: [],
    })

    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchEnd)

    expect(el.style.transform).toBe('translateY(100%)')
    vi.advanceTimersByTime(300)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('does not attach listeners when enabled is false', () => {
    const onDismiss = vi.fn()
    render(<TestComponent onDismiss={onDismiss} enabled={false} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 250 } as Touch],
    })
    const touchEnd = new TouchEvent('touchend', {
      touches: [],
    })

    el.dispatchEvent(touchStart)
    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchEnd)

    vi.advanceTimersByTime(300)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(el.style.transform).toBe('')
  })

  it('does not respond to upward swipes', () => {
    const onDismiss = vi.fn()
    render(<TestComponent onDismiss={onDismiss} threshold={100} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 200 } as Touch],
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 50 } as Touch],
    })
    const touchEnd = new TouchEvent('touchend', {
      touches: [],
    })

    el.dispatchEvent(touchStart)
    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchEnd)

    vi.advanceTimersByTime(300)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('handles touchcancel like touchend', () => {
    const onDismiss = vi.fn()
    render(<TestComponent onDismiss={onDismiss} threshold={100} />)
    const el = document.querySelector('[data-testid="swipeable"]') as HTMLElement

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientY: 250 } as Touch],
    })
    const touchCancel = new TouchEvent('touchcancel', {
      touches: [],
    })

    el.dispatchEvent(touchStart)
    el.dispatchEvent(touchMove)
    el.dispatchEvent(touchCancel)

    expect(el.style.transform).toBe('translateY(100%)')
    vi.advanceTimersByTime(300)
    expect(onDismiss).toHaveBeenCalled()
  })
})
