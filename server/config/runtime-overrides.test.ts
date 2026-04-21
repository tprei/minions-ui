import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTmpDir(): string {
  const dir = join(tmpdir(), `overrides-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

let tmpDir: string
let origRoot: string | undefined

beforeEach(() => {
  tmpDir = makeTmpDir()
  origRoot = process.env['WORKSPACE_ROOT']
  process.env['WORKSPACE_ROOT'] = tmpDir
})

afterEach(() => {
  if (origRoot === undefined) {
    delete process.env['WORKSPACE_ROOT']
  } else {
    process.env['WORKSPACE_ROOT'] = origRoot
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadOverrides', () => {
  test('returns empty object when no file exists', async () => {
    const { loadOverrides } = await import('./runtime-overrides')
    expect(loadOverrides()).toEqual({})
  })

  test('returns parsed overrides when file exists', async () => {
    const { loadOverrides, saveOverrides } = await import('./runtime-overrides')
    saveOverrides({ quota: { retryMax: 5 } })
    const result = loadOverrides()
    expect(result.quota?.retryMax).toBe(5)
  })

  test('returns empty object when file has invalid JSON', async () => {
    const { loadOverrides } = await import('./runtime-overrides')
    const path = join(tmpDir, '.runtime-overrides.json')
    Bun.write(path, 'not valid json')
    const result = loadOverrides()
    expect(result).toEqual({})
  })

  test('returns empty object when file has invalid schema', async () => {
    const { loadOverrides } = await import('./runtime-overrides')
    const path = join(tmpDir, '.runtime-overrides.json')
    await Bun.write(path, JSON.stringify({ loops: 'not-an-object' }))
    const result = loadOverrides()
    expect(result).toEqual({})
  })
})

describe('saveOverrides', () => {
  test('creates file and returns merged overrides', async () => {
    const { saveOverrides } = await import('./runtime-overrides')
    const result = saveOverrides({ workspace: { maxConcurrentSessions: 3 } })
    expect(result.workspace?.maxConcurrentSessions).toBe(3)
    const path = join(tmpDir, '.runtime-overrides.json')
    expect(existsSync(path)).toBe(true)
  })

  test('deep-merges loops without clobbering existing keys', async () => {
    const { saveOverrides, loadOverrides } = await import('./runtime-overrides')
    saveOverrides({ loops: { 'test-coverage': { enabled: false } } })
    saveOverrides({ loops: { 'dead-code': { intervalMs: 60000 } } })
    const result = loadOverrides()
    expect(result.loops?.['test-coverage']?.enabled).toBe(false)
    expect(result.loops?.['dead-code']?.intervalMs).toBe(60000)
  })

  test('merges nested workspace fields', async () => {
    const { saveOverrides } = await import('./runtime-overrides')
    saveOverrides({ workspace: { maxConcurrentSessions: 2 } })
    const result = saveOverrides({ quota: { retryMax: 10 } })
    expect(result.workspace?.maxConcurrentSessions).toBe(2)
    expect(result.quota?.retryMax).toBe(10)
  })

  test('patch overrides existing loop field', async () => {
    const { saveOverrides } = await import('./runtime-overrides')
    saveOverrides({ loops: { 'test-coverage': { intervalMs: 10000, enabled: true } } })
    const result = saveOverrides({ loops: { 'test-coverage': { intervalMs: 20000 } } })
    expect(result.loops?.['test-coverage']?.intervalMs).toBe(20000)
    expect(result.loops?.['test-coverage']?.enabled).toBe(true)
  })
})
