import { describe, it, expect } from 'vitest'
import { MIN_TOUCH_TARGET_SIZE, HAPTIC_PATTERNS } from '../../src/a11y/constants'

describe('a11y/constants', () => {
  describe('MIN_TOUCH_TARGET_SIZE', () => {
    it('should be 44px (WCAG 2.1 AA mobile minimum)', () => {
      expect(MIN_TOUCH_TARGET_SIZE).toBe(44)
    })

    it('should be a positive number', () => {
      expect(MIN_TOUCH_TARGET_SIZE).toBeGreaterThan(0)
    })
  })

  describe('HAPTIC_PATTERNS', () => {
    it('should define light pattern', () => {
      expect(HAPTIC_PATTERNS.light).toBe(10)
    })

    it('should define medium pattern', () => {
      expect(HAPTIC_PATTERNS.medium).toBe(25)
    })

    it('should define heavy pattern', () => {
      expect(HAPTIC_PATTERNS.heavy).toBe(50)
    })

    it('should define success pattern as array', () => {
      expect(HAPTIC_PATTERNS.success).toEqual([10, 50, 10])
    })

    it('should define error pattern as array', () => {
      expect(HAPTIC_PATTERNS.error).toEqual([50, 100, 50])
    })

    it('should define warning pattern as array', () => {
      expect(HAPTIC_PATTERNS.warning).toEqual([25, 50, 25])
    })

    it('should have all duration values as positive numbers', () => {
      Object.values(HAPTIC_PATTERNS).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((v) => expect(v).toBeGreaterThan(0))
        } else {
          expect(value).toBeGreaterThan(0)
        }
      })
    })
  })
})
