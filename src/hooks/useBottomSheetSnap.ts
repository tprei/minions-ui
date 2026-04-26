import { useRef, useEffect, useCallback, useState } from 'preact/hooks'

export type SnapPoint = 'peek' | 'half' | 'full'

export interface BottomSheetSnapOptions {
  enabled?: boolean
  initialSnap?: SnapPoint
  onSnapChange?: (snap: SnapPoint) => void
}

interface TouchState {
  startY: number
  currentY: number
  isDragging: boolean
  startTime: number
  startSnap: SnapPoint
}

const SNAP_HEIGHTS = {
  peek: 0.25,
  half: 0.5,
  full: 0.9,
}

export function useBottomSheetSnap({
  enabled = true,
  initialSnap = 'peek',
  onSnapChange,
}: BottomSheetSnapOptions = {}) {
  const elementRef = useRef<HTMLElement | null>(null)
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>(initialSnap)
  const stateRef = useRef<TouchState>({
    startY: 0,
    currentY: 0,
    isDragging: false,
    startTime: 0,
    startSnap: initialSnap,
  })

  const getSnapHeight = useCallback((snap: SnapPoint): number => {
    if (typeof window === 'undefined') return 0
    return window.innerHeight * SNAP_HEIGHTS[snap]
  }, [])

  const findNearestSnap = useCallback((currentHeight: number): SnapPoint => {
    const vh = window.innerHeight
    const peekH = vh * SNAP_HEIGHTS.peek
    const halfH = vh * SNAP_HEIGHTS.half
    const fullH = vh * SNAP_HEIGHTS.full

    const distToPeek = Math.abs(currentHeight - peekH)
    const distToHalf = Math.abs(currentHeight - halfH)
    const distToFull = Math.abs(currentHeight - fullH)

    if (distToPeek <= distToHalf && distToPeek <= distToFull) return 'peek'
    if (distToHalf <= distToFull) return 'half'
    return 'full'
  }, [])

  const snapTo = useCallback(
    (snap: SnapPoint, immediate = false) => {
      const element = elementRef.current
      if (!element) return

      const targetHeight = getSnapHeight(snap)
      const maxHeight = window.innerHeight * SNAP_HEIGHTS.full

      element.style.transition = immediate ? 'none' : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      element.style.height = `${Math.min(targetHeight, maxHeight)}px`

      setCurrentSnap(snap)
      if (onSnapChange) onSnapChange(snap)
    },
    [getSnapHeight, onSnapChange],
  )

  useEffect(() => {
    const element = elementRef.current
    if (!element || !enabled) return

    snapTo(initialSnap, true)

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      const handle = element.querySelector('[data-bottom-sheet-handle]')
      if (!handle || !handle.contains(target)) return

      const touch = e.touches[0]
      stateRef.current = {
        startY: touch.clientY,
        currentY: touch.clientY,
        isDragging: true,
        startTime: Date.now(),
        startSnap: currentSnap,
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!stateRef.current.isDragging) return

      const touch = e.touches[0]
      const deltaY = touch.clientY - stateRef.current.startY
      const currentHeight = getSnapHeight(stateRef.current.startSnap)
      const newHeight = Math.max(
        getSnapHeight('peek'),
        Math.min(getSnapHeight('full'), currentHeight - deltaY),
      )

      element.style.transition = 'none'
      element.style.height = `${newHeight}px`
      stateRef.current.currentY = touch.clientY
    }

    const handleTouchEnd = () => {
      if (!stateRef.current.isDragging) return

      const deltaY = stateRef.current.startY - stateRef.current.currentY
      const duration = Date.now() - stateRef.current.startTime
      const velocity = deltaY / duration

      const currentHeight = parseFloat(element.style.height)
      let targetSnap: SnapPoint

      if (Math.abs(velocity) > 0.5) {
        if (velocity > 0) {
          targetSnap =
            currentSnap === 'peek' ? 'half' : currentSnap === 'half' ? 'full' : 'full'
        } else {
          targetSnap =
            currentSnap === 'full' ? 'half' : currentSnap === 'half' ? 'peek' : 'peek'
        }
      } else {
        targetSnap = findNearestSnap(currentHeight)
      }

      snapTo(targetSnap)
      stateRef.current.isDragging = false
    }

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: true })
    element.addEventListener('touchend', handleTouchEnd)
    element.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, initialSnap, getSnapHeight, findNearestSnap, snapTo])

  return {
    elementRef,
    currentSnap,
    snapTo,
  }
}
