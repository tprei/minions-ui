import { useCallback } from 'preact/hooks'

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error'

const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 50,
  success: [10, 50, 10],
  error: [50, 100, 50],
}

export function useHaptics() {
  const vibrate = useCallback((pattern: HapticPattern = 'medium') => {
    if (navigator.vibrate) {
      navigator.vibrate(HAPTIC_PATTERNS[pattern])
    }
  }, [])

  const supported = 'vibrate' in navigator

  return { vibrate, supported }
}
