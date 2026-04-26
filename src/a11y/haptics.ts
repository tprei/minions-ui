import { HAPTIC_PATTERNS, type HapticPattern } from './constants'

export function vibrate(pattern: HapticPattern | number | number[]): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) {
    return
  }

  if (typeof pattern === 'string') {
    const hapticValue = HAPTIC_PATTERNS[pattern]
    navigator.vibrate(hapticValue)
  } else {
    navigator.vibrate(pattern)
  }
}

export function vibrateLight(): void {
  vibrate('light')
}

export function vibrateMedium(): void {
  vibrate('medium')
}

export function vibrateHeavy(): void {
  vibrate('heavy')
}

export function vibrateSuccess(): void {
  vibrate('success')
}

export function vibrateError(): void {
  vibrate('error')
}

export function vibrateWarning(): void {
  vibrate('warning')
}

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}
