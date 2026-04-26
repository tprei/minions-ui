import { describe, it, expect } from 'vitest'
import { signal } from '@preact/signals'
import { hasFeature } from '../../src/api/features'
import type { ConnectionStore } from '../../src/state/types'
import type { VersionInfo } from '../../src/api/types'

function makeStore(version: VersionInfo | null): ConnectionStore {
  return {
    version: signal(version),
  } as unknown as ConnectionStore
}

describe('hasFeature', () => {
  it('returns false when source is null/undefined', () => {
    expect(hasFeature(null, 'pr-preview')).toBe(false)
    expect(hasFeature(undefined, 'pr-preview')).toBe(false)
  })

  it('returns false when version signal is null', () => {
    expect(hasFeature(makeStore(null), 'pr-preview')).toBe(false)
  })

  it('returns false when feature not listed', () => {
    const store = makeStore({ apiVersion: '1', libraryVersion: '1.0.0', features: ['messages'] })
    expect(hasFeature(store, 'pr-preview')).toBe(false)
  })

  it('returns true when feature is listed', () => {
    const store = makeStore({
      apiVersion: '1',
      libraryVersion: '1.1.0',
      features: ['messages', 'pr-preview', 'diff'],
    })
    expect(hasFeature(store, 'pr-preview')).toBe(true)
    expect(hasFeature(store, 'diff')).toBe(true)
    expect(hasFeature(store, 'messages')).toBe(true)
  })

  it('accepts a raw VersionInfo without a store wrapper', () => {
    const v: VersionInfo = { apiVersion: '1', libraryVersion: '1.1.0', features: ['web-push'] }
    expect(hasFeature(v, 'web-push')).toBe(true)
    expect(hasFeature(v, 'diff')).toBe(false)
  })

  it('recognizes memory feature', () => {
    const store = makeStore({
      apiVersion: '1',
      libraryVersion: '1.110.0',
      features: ['memory', 'messages'],
    })
    expect(hasFeature(store, 'memory')).toBe(true)
  })
})
