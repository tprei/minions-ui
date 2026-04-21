import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTmpDir(): string {
  const dir = join(tmpdir(), `local-defaults-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

let tmpDir: string
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['PORT', 'CORS_ALLOWED_ORIGINS', 'MINION_API_TOKEN', 'GITHUB_TOKEN', 'WORKSPACE_ROOT']

beforeEach(() => {
  tmpDir = makeTmpDir()
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env['WORKSPACE_ROOT'] = tmpDir
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const val = savedEnv[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('applyLocalDefaults', () => {
  test('sets PORT=8080 when not set', async () => {
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['PORT']).toBe('8080')
  })

  test('does not override PORT when already set', async () => {
    process.env['PORT'] = '9000'
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['PORT']).toBe('9000')
  })

  test('sets CORS_ALLOWED_ORIGINS default', async () => {
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['CORS_ALLOWED_ORIGINS']).toBe('http://localhost:5173')
  })

  test('does not override CORS_ALLOWED_ORIGINS when already set', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['CORS_ALLOWED_ORIGINS']).toBe('https://example.com')
  })

  test('generates MINION_API_TOKEN and writes .api-token file', async () => {
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    const token = process.env['MINION_API_TOKEN']
    expect(token).toBeDefined()
    expect(token?.length).toBe(32)
    const tokenFile = join(tmpDir, '.api-token')
    expect(existsSync(tokenFile)).toBe(true)
    if (token !== undefined) {
      expect(readFileSync(tokenFile, 'utf8').trim()).toBe(token)
    }
  })

  test('reads existing .api-token file when no env set', async () => {
    const tokenFile = join(tmpDir, '.api-token')
    const existingToken = 'a'.repeat(32)
    await Bun.write(tokenFile, existingToken)
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['MINION_API_TOKEN']).toBe(existingToken)
  })

  test('does not override MINION_API_TOKEN when already set', async () => {
    const existing = 'b'.repeat(32)
    process.env['MINION_API_TOKEN'] = existing
    const { applyLocalDefaults } = await import('./local-defaults')
    await applyLocalDefaults()
    expect(process.env['MINION_API_TOKEN']).toBe(existing)
  })
})
