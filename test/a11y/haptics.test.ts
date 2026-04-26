import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  vibrate,
  vibrateLight,
  vibrateMedium,
  vibrateHeavy,
  vibrateSuccess,
  vibrateError,
  vibrateWarning,
  isHapticsSupported,
} from '../../src/a11y/haptics'
import { HAPTIC_PATTERNS } from '../../src/a11y/constants'

describe('a11y/haptics', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      value: vibrateSpy,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isHapticsSupported', () => {
    it('returns true when navigator.vibrate exists', () => {
      expect(isHapticsSupported()).toBe(true)
    })

    it('returns false when navigator.vibrate does not exist', () => {
      Object.defineProperty(navigator, 'vibrate', {
        writable: true,
        value: undefined,
      })
      expect(isHapticsSupported()).toBe(false)
    })
  })

  describe('vibrate', () => {
    it('calls navigator.vibrate with pattern name', () => {
      vibrate('light')
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.light)
    })

    it('calls navigator.vibrate with numeric value', () => {
      vibrate(100)
      expect(vibrateSpy).toHaveBeenCalledWith(100)
    })

    it('calls navigator.vibrate with array pattern', () => {
      const pattern = [10, 20, 30]
      vibrate(pattern)
      expect(vibrateSpy).toHaveBeenCalledWith(pattern)
    })

    it('does not throw when navigator.vibrate is unavailable', () => {
      Object.defineProperty(navigator, 'vibrate', {
        writable: true,
        value: undefined,
      })
      expect(() => vibrate('light')).not.toThrow()
    })

    it('handles success pattern array', () => {
      vibrate('success')
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.success)
    })

    it('handles error pattern array', () => {
      vibrate('error')
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.error)
    })
  })

  describe('convenience functions', () => {
    it('vibrateLight calls vibrate with light pattern', () => {
      vibrateLight()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.light)
    })

    it('vibrateMedium calls vibrate with medium pattern', () => {
      vibrateMedium()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.medium)
    })

    it('vibrateHeavy calls vibrate with heavy pattern', () => {
      vibrateHeavy()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.heavy)
    })

    it('vibrateSuccess calls vibrate with success pattern', () => {
      vibrateSuccess()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.success)
    })

    it('vibrateError calls vibrate with error pattern', () => {
      vibrateError()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.error)
    })

    it('vibrateWarning calls vibrate with warning pattern', () => {
      vibrateWarning()
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.warning)
    })

    it('all convenience functions work when vibrate is unavailable', () => {
      Object.defineProperty(navigator, 'vibrate', {
        writable: true,
        value: undefined,
      })
      expect(() => {
        vibrateLight()
        vibrateMedium()
        vibrateHeavy()
        vibrateSuccess()
        vibrateError()
        vibrateWarning()
      }).not.toThrow()
    })
  })
})
