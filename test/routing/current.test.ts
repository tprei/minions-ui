import { describe, it, expect } from 'vitest'
import { parseHash } from '../../src/routing/route'

describe('routing/current', () => {
  it('delegates to parseHash for route parsing', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/s/test-session')).toEqual({ name: 'session', sessionSlug: 'test-session' })
    expect(parseHash('#/g/group-123')).toEqual({ name: 'group', groupId: 'group-123' })
  })
})
