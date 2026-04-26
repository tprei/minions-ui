import { useRef, useEffect } from 'preact/hooks'

export interface SwipeToDismissOptions {
  onDismiss: () => void
  threshold?: number
  enabled?: boolean
}

interface TouchState {
  startY: number
  currentY: number
  isDragging: boolean
  startTime: number
}

export function useSwipeToDismiss<T extends HTMLElement = HTMLElement>({
  onDismiss,
  threshold = 150,
  enabled = true,
}: SwipeToDismissOptions) {
  const elementRef = useRef<T | null>(null)
  const stateRef = useRef<TouchState>({
    startY: 0,
    currentY: 0,
    isDragging: false,
    startTime: 0,
  })

  useEffect(() => {
    const element = elementRef.current
    if (!element || !enabled) return

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      stateRef.current = {
        startY: touch.clientY,
        currentY: touch.clientY,
        isDragging: true,
        startTime: Date.now(),
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!stateRef.current.isDragging) return

      const touch = e.touches[0]
      const deltaY = touch.clientY - stateRef.current.startY

      if (deltaY > 0) {
        stateRef.current.currentY = touch.clientY
        const translateY = Math.min(deltaY, threshold * 2)
        element.style.transform = `translateY(${translateY}px)`
        element.style.transition = 'none'
      }
    }

    const handleTouchEnd = () => {
      if (!stateRef.current.isDragging) return

      const deltaY = stateRef.current.currentY - stateRef.current.startY
      const duration = Date.now() - stateRef.current.startTime
      const velocity = Math.abs(deltaY) / duration

      element.style.transition = 'transform 0.3s ease-out'

      if (deltaY > threshold || velocity > 0.5) {
        element.style.transform = `translateY(100%)`
        setTimeout(() => {
          onDismiss()
        }, 300)
      } else {
        element.style.transform = 'translateY(0)'
      }

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
  }, [enabled, threshold, onDismiss])

  return elementRef
}
