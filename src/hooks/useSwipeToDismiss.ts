import { useRef, useCallback, useEffect } from 'preact/hooks'
import { vibrateLight } from '../a11y'

const DISMISS_THRESHOLD = 100
const HAPTIC_THRESHOLD = 60

export interface UseSwipeToDismissOptions {
  onDismiss: () => void
  enabled?: boolean
}

export function useSwipeToDismiss({ onDismiss, enabled = true }: UseSwipeToDismissOptions) {
  const startYRef = useRef<number | null>(null)
  const currentYRef = useRef<number | null>(null)
  const hapticFiredRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (!enabled) return
    startYRef.current = e.clientY
    currentYRef.current = e.clientY
    hapticFiredRef.current = false
    if (containerRef.current) {
      containerRef.current.style.transition = 'none'
    }
  }, [enabled])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!enabled || startYRef.current === null) return
    currentYRef.current = e.clientY
    const deltaY = currentYRef.current - startYRef.current

    if (deltaY > 0 && containerRef.current) {
      containerRef.current.style.transform = `translateY(${deltaY}px)`

      if (deltaY >= HAPTIC_THRESHOLD && !hapticFiredRef.current) {
        vibrateLight()
        hapticFiredRef.current = true
      }
    }
  }, [enabled])

  const handlePointerUp = useCallback(() => {
    if (!enabled || startYRef.current === null || currentYRef.current === null) return

    const deltaY = currentYRef.current - startYRef.current

    if (deltaY >= DISMISS_THRESHOLD) {
      if (containerRef.current) {
        containerRef.current.style.transition = 'transform 0.2s ease-out'
        containerRef.current.style.transform = 'translateY(100%)'
      }
      setTimeout(onDismiss, 200)
    } else {
      if (containerRef.current) {
        containerRef.current.style.transition = 'transform 0.2s ease-out'
        containerRef.current.style.transform = 'translateY(0)'
      }
    }

    startYRef.current = null
    currentYRef.current = null
    hapticFiredRef.current = false
  }, [enabled, onDismiss])

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
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
