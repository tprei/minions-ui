import { describe, test, expect, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ProfileStore } from './profile-store'
import type { ProviderProfile } from '../../shared/api-types'

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'

const tmpDirs: string[] = []

function trackedDir(): string {
  const dir = path.join(TMPDIR, `profile-store-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

function makeProfile(id: string): ProviderProfile {
  return { id, name: `Profile ${id}` }
}

describe('ProfileStore', () => {
  test('list returns empty array on fresh store', () => {
    const store = new ProfileStore(trackedDir())
    expect(store.list()).toEqual([])
  })

  test('add then list returns the profile', () => {
    const store = new ProfileStore(trackedDir())
    const p = makeProfile('p1')
    store.add(p)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toEqual(p)
  })

  test('add duplicate id throws', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('dup'))
    expect(() => store.add(makeProfile('dup'))).toThrow()
  })

  test('get returns profile by id', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('get-me'))
    expect(store.get('get-me')?.name).toBe('Profile get-me')
    expect(store.get('missing')).toBeUndefined()
  })

  test('update patches profile fields', () => {
    const store = new ProfileStore(trackedDir())
    store.add({ id: 'upd', name: 'Old' })
    const updated = store.update('upd', { name: 'New', baseUrl: 'https://example.com' })
    expect(updated.name).toBe('New')
    expect(updated.baseUrl).toBe('https://example.com')
    expect(store.get('upd')?.name).toBe('New')
  })

  test('update throws for missing id', () => {
    const store = new ProfileStore(trackedDir())
    expect(() => store.update('ghost', { name: 'x' })).toThrow()
  })

  test('remove deletes the profile', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('rm'))
    store.remove('rm')
    expect(store.list()).toHaveLength(0)
  })

  test('remove throws for missing id', () => {
    const store = new ProfileStore(trackedDir())
    expect(() => store.remove('ghost')).toThrow()
  })

  test('setDefaultId and getDefaultId', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('def'))
    store.setDefaultId('def')
    expect(store.getDefaultId()).toBe('def')
  })

  test('setDefaultId throws for unknown id', () => {
    const store = new ProfileStore(trackedDir())
    expect(() => store.setDefaultId('ghost')).toThrow()
  })

  test('remove clears defaultId when the default is removed', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('d'))
    store.setDefaultId('d')
    store.remove('d')
    expect(store.getDefaultId()).toBeUndefined()
  })

  test('clearDefault unsets the default', () => {
    const store = new ProfileStore(trackedDir())
    store.add(makeProfile('clr'))
    store.setDefaultId('clr')
    store.clearDefault()
    expect(store.getDefaultId()).toBeUndefined()
  })

  test('persists across re-instantiation', () => {
    const dir = trackedDir()
    const s1 = new ProfileStore(dir)
    s1.add({ id: 'persist', name: 'Persist me' })
    s1.setDefaultId('persist')

    const s2 = new ProfileStore(dir)
    expect(s2.list()).toHaveLength(1)
    expect(s2.getDefaultId()).toBe('persist')
  })
})
