import { useEffect, useRef, useState } from 'preact/hooks'

function findScrollableParent(element: HTMLElement, stopAt: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element
  while (current && current !== stopAt) {
    const overflowY = window.getComputedStyle(current).overflowY
    const isScrollable = overflowY === 'auto' || overflowY === 'scroll'
    if (isScrollable && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return null
}

interface PullToRefreshOptions {
  onRefresh: () => void | Promise<void>
  threshold?: number
  resistance?: number
  enabled?: boolean
}

interface PullToRefreshResult {
  pullDistance: number
  isRefreshing: boolean
  containerProps: {
    ref: (el: HTMLElement | null) => void
    onTouchStart: (e: TouchEvent) => void
    onTouchMove: (e: TouchEvent) => void
    onTouchEnd: () => void
  }
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  resistance = 2.5,
  enabled = true,
}: PullToRefreshOptions): PullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const containerRef = useRef<HTMLElement | null>(null)
  const touchStartY = useRef<number | null>(null)
  const scrollTopAtStart = useRef<number>(0)

  const handleTouchStart = (e: TouchEvent) => {
    if (!enabled || isRefreshing) return
    const container = containerRef.current
    if (!container) return

    const target = e.target as HTMLElement
    const scrollableParent = findScrollableParent(target, container)
    if (scrollableParent && scrollableParent !== container) {
      return
    }

    scrollTopAtStart.current = container.scrollTop
    if (scrollTopAtStart.current === 0) {
      touchStartY.current = e.touches[0].clientY
    }
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!enabled || isRefreshing || touchStartY.current === null) return
    const container = containerRef.current
    if (!container || container.scrollTop > 0) {
      touchStartY.current = null
      setPullDistance(0)
      return
    }

    const target = e.target as HTMLElement
    const scrollableParent = findScrollableParent(target, container)
    if (scrollableParent && scrollableParent !== container) {
      touchStartY.current = null
      setPullDistance(0)
      return
    }

    const touchY = e.touches[0].clientY
    const deltaY = touchY - touchStartY.current

    if (deltaY > 0) {
      const distance = Math.min(deltaY / resistance, threshold * 1.5)
      setPullDistance(distance)
      if (distance > 10) {
        e.preventDefault()
      }
    }
  }

  const handleTouchEnd = () => {
    if (!enabled || isRefreshing || touchStartY.current === null) {
      touchStartY.current = null
      setPullDistance(0)
      return
    }

    touchStartY.current = null

    if (pullDistance >= threshold) {
      setIsRefreshing(true)
      setPullDistance(threshold)
      Promise.resolve(onRefresh()).finally(() => {
        setIsRefreshing(false)
        setPullDistance(0)
      })
    } else {
      setPullDistance(0)
    }
  }

  const setContainerRef = (el: HTMLElement | null) => {
    containerRef.current = el
  }

  useEffect(() => {
    if (!enabled) {
      setPullDistance(0)
      setIsRefreshing(false)
      touchStartY.current = null
    }
  }, [enabled])

  return {
    pullDistance,
    isRefreshing,
    containerProps: {
      ref: setContainerRef,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}
