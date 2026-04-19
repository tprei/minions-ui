import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseHash, formatRoute, createRouter } from '../../src/routing/route'

describe('parseHash', () => {
  it('returns home for empty/missing', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })

  it('parses session slug', () => {
    expect(parseHash('#/s/fast-cat')).toEqual({ name: 'session', sessionSlug: 'fast-cat' })
  })

  it('decodes percent-encoded segments', () => {
    expect(parseHash('#/s/cool%20slug')).toEqual({ name: 'session', sessionSlug: 'cool slug' })
  })

  it('parses group id', () => {
    expect(parseHash('#/g/grp-1')).toEqual({ name: 'group', groupId: 'grp-1' })
  })

  it('unknown shape falls back to home', () => {
    expect(parseHash('#/foo/bar')).toEqual({ name: 'home' })
    expect(parseHash('#/s')).toEqual({ name: 'home' })
  })
})

describe('formatRoute', () => {
  it('round-trips through parseHash', () => {
    expect(parseHash(formatRoute({ name: 'home' }))).toEqual({ name: 'home' })
    expect(parseHash(formatRoute({ name: 'session', sessionSlug: 'fast-cat' }))).toEqual({
      name: 'session',
      sessionSlug: 'fast-cat',
    })
    expect(parseHash(formatRoute({ name: 'group', groupId: 'grp-1' }))).toEqual({
      name: 'group',
      groupId: 'grp-1',
    })
  })

  it('encodes special characters', () => {
    const hash = formatRoute({ name: 'session', sessionSlug: 'has spaces' })
    expect(hash).toBe('#/s/has%20spaces')
  })
})

describe('createRouter', () => {
  const originalHash = window.location.hash

  beforeEach(() => {
    window.location.hash = ''
  })

  afterEach(() => {
    window.location.hash = originalHash
  })

  it('initializes route from current hash', () => {
    window.location.hash = '#/s/foo'
    const r = createRouter()
    expect(r.route.value).toEqual({ name: 'session', sessionSlug: 'foo' })
    r.dispose()
  })

  it('updates route on hashchange', () => {
    const r = createRouter()
    expect(r.route.value).toEqual({ name: 'home' })

    window.location.hash = '#/g/grp-9'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(r.route.value).toEqual({ name: 'group', groupId: 'grp-9' })
    r.dispose()
  })

  it('navigate() sets the hash and updates the route', () => {
    const r = createRouter()
    r.navigate({ name: 'session', sessionSlug: 'ab' })
    // location.hash change in jsdom fires a hashchange synchronously in newer versions,
    // but for safety nudge it manually:
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(r.route.value).toEqual({ name: 'session', sessionSlug: 'ab' })
    expect(window.location.hash).toBe('#/s/ab')
    r.dispose()
  })

  it('navigate() to the same hash still updates the signal', () => {
    window.location.hash = '#/s/foo'
    const r = createRouter()
    const initial = r.route.value
    r.navigate({ name: 'session', sessionSlug: 'foo' })
    expect(r.route.value).toEqual(initial)
    r.dispose()
  })

  it('dispose() stops listening to hashchange', () => {
    const r = createRouter()
    r.dispose()
    window.location.hash = '#/s/never-seen'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(r.route.value).toEqual({ name: 'home' })
  })
})
