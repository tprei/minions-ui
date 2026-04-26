export const MIN_TOUCH_TARGET_SIZE = 44

export const HAPTIC_PATTERNS = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [10, 50, 10],
  error: [50, 100, 50],
  warning: [25, 50, 25],
} as const

export type HapticPattern = keyof typeof HAPTIC_PATTERNS
