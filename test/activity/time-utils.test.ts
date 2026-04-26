import { describe, it, expect } from 'vitest'
import { formatDistanceToNow } from '../../src/activity/time-utils'

describe('formatDistanceToNow', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = Date.now()
    expect(formatDistanceToNow(now)).toBe('just now')
    expect(formatDistanceToNow(now - 30 * 1000)).toBe('just now')
  })

  it('returns minutes ago for timestamps within an hour', () => {
    const now = Date.now()
    expect(formatDistanceToNow(now - 2 * 60 * 1000)).toBe('2 minutes ago')
    expect(formatDistanceToNow(now - 1 * 60 * 1000)).toBe('1 minute ago')
    expect(formatDistanceToNow(now - 45 * 60 * 1000)).toBe('45 minutes ago')
  })

  it('returns hours ago for timestamps within a day', () => {
    const now = Date.now()
    expect(formatDistanceToNow(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago')
    expect(formatDistanceToNow(now - 1 * 60 * 60 * 1000)).toBe('1 hour ago')
    expect(formatDistanceToNow(now - 23 * 60 * 60 * 1000)).toBe('23 hours ago')
  })

  it('returns days ago for timestamps within a month', () => {
    const now = Date.now()
    expect(formatDistanceToNow(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago')
    expect(formatDistanceToNow(now - 1 * 24 * 60 * 60 * 1000)).toBe('1 day ago')
    expect(formatDistanceToNow(now - 29 * 24 * 60 * 60 * 1000)).toBe('29 days ago')
  })

  it('returns formatted date for timestamps over a month old', () => {
    const oldDate = Date.now() - 35 * 24 * 60 * 60 * 1000
    const result = formatDistanceToNow(oldDate)
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/)
  })
})
