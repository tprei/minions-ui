import { useRef, useCallback, useEffect, useState } from 'preact/hooks'
import { vibrateLight } from '../a11y'

export type SnapPoint = 'peek' | 'half' | 'full'

export interface UseBottomSheetOptions {
  defaultSnap?: SnapPoint
  enabled?: boolean
  onSnapChange?: (snap: SnapPoint) => void
}

interface SnapConfig {
  peek: number
  half: number
  full: number
}

const HAPTIC_THRESHOLD = 30
const VELOCITY_THRESHOLD = 0.5

function getSnapConfig(): SnapConfig {
  const vh = window.innerHeight
  return {
    peek: vh * 0.15,
    half: vh * 0.5,
    full: vh * 0.92,
  }
}

function getSnapPointHeight(snap: SnapPoint, config: SnapConfig): number {
  return config[snap]
}

function findNearestSnap(height: number, config: SnapConfig, velocity: number): SnapPoint {
  const { peek, half, full } = config
  const points: Array<{ snap: SnapPoint; height: number }> = [
    { snap: 'peek', height: peek },
    { snap: 'half', height: half },
    { snap: 'full', height: full },
  ]

  if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
    if (velocity < 0) {
      const next = points.find((p) => p.height > height)
      if (next) return next.snap
    } else {
      const prev = [...points].reverse().find((p) => p.height < height)
      if (prev) return prev.snap
    }
  }

  let nearest = points[0]
  let minDist = Math.abs(height - peek)

  for (const point of points) {
    const dist = Math.abs(height - point.height)
    if (dist < minDist) {
      minDist = dist
      nearest = point
    }
  }

  return nearest.snap
}

export function useBottomSheet({ defaultSnap = 'peek', enabled = true, onSnapChange }: UseBottomSheetOptions) {
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>(defaultSnap)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef<number | null>(null)
  const startHeightRef = useRef<number | null>(null)
  const currentHeightRef = useRef<number | null>(null)
  const lastHapticSnapRef = useRef<SnapPoint | null>(null)
  const startTimeRef = useRef<number>(0)
  const isDraggingRef = useRef(false)
  const startScrollTopRef = useRef<number>(0)
  const allowDragRef = useRef(false)

  const snapTo = useCallback(
    (snap: SnapPoint, animated = true) => {
      if (!containerRef.current) return
      const config = getSnapConfig()
      const height = getSnapPointHeight(snap, config)

      if (animated) {
        containerRef.current.style.transition = 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
      } else {
        containerRef.current.style.transition = 'none'
      }

      containerRef.current.style.height = `${height}px`
      setCurrentSnap(snap)
      onSnapChange?.(snap)
    },
    [onSnapChange],
  )

  useEffect(() => {
    if (!enabled) return
    const config = getSnapConfig()
    const height = getSnapPointHeight(currentSnap, config)
    if (containerRef.current) {
      containerRef.current.style.height = `${height}px`
    }
  }, [currentSnap, enabled])

  useEffect(() => {
    if (!enabled) return
    const handleResize = () => {
      const config = getSnapConfig()
      const height = getSnapPointHeight(currentSnap, config)
      if (containerRef.current) {
        containerRef.current.style.transition = 'none'
        containerRef.current.style.height = `${height}px`
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [currentSnap, enabled])

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!enabled || !containerRef.current) return

      const target = e.target as HTMLElement
      const scrollContainer = contentRef.current

      if (scrollContainer && scrollContainer.contains(target)) {
        const isScrollable = scrollContainer.scrollHeight > scrollContainer.clientHeight
        const scrollTop = scrollContainer.scrollTop
        startScrollTopRef.current = scrollTop

        if (isScrollable && scrollTop > 0) {
          allowDragRef.current = false
        } else {
          allowDragRef.current = true
        }
      } else {
        allowDragRef.current = true
      }

      startYRef.current = e.clientY
      startHeightRef.current = containerRef.current.offsetHeight
      currentHeightRef.current = startHeightRef.current
      lastHapticSnapRef.current = null
      startTimeRef.current = Date.now()
      isDraggingRef.current = false

      if (containerRef.current) {
        containerRef.current.style.transition = 'none'
      }
    },
    [enabled],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!enabled || startYRef.current === null || startHeightRef.current === null) return
      if (!containerRef.current) return

      const deltaY = startYRef.current - e.clientY
      const newHeight = startHeightRef.current + deltaY

      const scrollContainer = contentRef.current
      if (scrollContainer && !allowDragRef.current) {
        const scrollTop = scrollContainer.scrollTop
        if (deltaY < 0 && scrollTop <= 0) {
          allowDragRef.current = true
          startYRef.current = e.clientY
          startHeightRef.current = containerRef.current.offsetHeight
        } else {
          return
        }
      }

      if (!isDraggingRef.current && Math.abs(deltaY) > 5) {
        isDraggingRef.current = true
      }

      const config = getSnapConfig()
      const clampedHeight = Math.max(config.peek, Math.min(config.full, newHeight))
      currentHeightRef.current = clampedHeight
      containerRef.current.style.height = `${clampedHeight}px`

      const nearestSnap = findNearestSnap(clampedHeight, config, 0)
      if (nearestSnap !== lastHapticSnapRef.current) {
        const snapHeight = getSnapPointHeight(nearestSnap, config)
        if (Math.abs(clampedHeight - snapHeight) < HAPTIC_THRESHOLD) {
          vibrateLight()
          lastHapticSnapRef.current = nearestSnap
        }
      }
    },
    [enabled],
  )

  const handlePointerUp = useCallback(() => {
    if (!enabled || startYRef.current === null || currentHeightRef.current === null) return

    const duration = Date.now() - startTimeRef.current
    const velocity = duration > 0 ? (currentHeightRef.current - (startHeightRef.current ?? 0)) / duration : 0

    const config = getSnapConfig()
    const targetSnap = findNearestSnap(currentHeightRef.current, config, velocity)

    snapTo(targetSnap, true)

    startYRef.current = null
    startHeightRef.current = null
    currentHeightRef.current = null
    isDraggingRef.current = false
    allowDragRef.current = false
  }, [enabled, snapTo])

  useEffect(() => {
    if (!enabled) return

    const handleGlobalPointerMove = (e: PointerEvent) => handlePointerMove(e)
    const handleGlobalPointerUp = () => handlePointerUp()

    document.addEventListener('pointermove', handleGlobalPointerMove)
    document.addEventListener('pointerup', handleGlobalPointerUp)
    document.addEventListener('pointercancel', handleGlobalPointerUp)

    return () => {
      document.removeEventListener('pointermove', handleGlobalPointerMove)
      document.removeEventListener('pointerup', handleGlobalPointerUp)
      document.removeEventListener('pointercancel', handleGlobalPointerUp)
    }
  }, [handlePointerMove, handlePointerUp, enabled])

  return {
    containerRef,
    contentRef,
    currentSnap,
    snapTo,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
