import { describe, it, expect, beforeEach } from 'vitest'
import { route, navigate } from '../../src/routing/route'

describe('route', () => {
  beforeEach(() => {
    window.location.hash = ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })

  it('defaults to home when hash is empty', () => {
    expect(route.value).toEqual({ name: 'home' })
  })

  it('parses session route', () => {
    window.location.hash = '#session/abc-123'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(route.value).toEqual({ name: 'session', sessionId: 'abc-123' })
  })

  it('parses variants route', () => {
    window.location.hash = '#variants/grp-42'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(route.value).toEqual({ name: 'variants', groupId: 'grp-42' })
  })

  it('falls back to home for unknown hash', () => {
    window.location.hash = '#unknown/something'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(route.value).toEqual({ name: 'home' })
  })

  it('navigate() sets hash for session', () => {
    navigate({ name: 'session', sessionId: 's1' })
    expect(window.location.hash).toBe('#session/s1')
  })

  it('navigate() sets hash for variants', () => {
    navigate({ name: 'variants', groupId: 'g1' })
    expect(window.location.hash).toBe('#variants/g1')
  })

  it('navigate() clears hash for home', () => {
    window.location.hash = '#session/x'
    navigate({ name: 'home' })
    expect(window.location.hash === '' || window.location.hash === '#').toBe(true)
  })
})
