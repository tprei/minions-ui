import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { handleConfigCommand } from './config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'

let tmpDir = ''
let origWorkspaceRoot: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'config-test-'))
  origWorkspaceRoot = process.env['WORKSPACE_ROOT']
  process.env['WORKSPACE_ROOT'] = tmpDir
})

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  if (origWorkspaceRoot !== undefined) {
    process.env['WORKSPACE_ROOT'] = origWorkspaceRoot
  } else {
    delete process.env['WORKSPACE_ROOT']
  }
})

describe('handleConfigCommand', () => {
  test('show returns ok with overrides', () => {
    const result = handleConfigCommand('show')
    expect(result.ok).toBe(true)
    expect(result.overrides).toBeDefined()
    expect(result.text).toBeTruthy()
  })

  test('empty string defaults to show', () => {
    const result = handleConfigCommand('')
    expect(result.ok).toBe(true)
    expect(result.overrides).toBeDefined()
  })

  test('set writes a boolean override', () => {
    const result = handleConfigCommand('set mcp.browserEnabled=false')
    expect(result.ok).toBe(true)

    const showResult = handleConfigCommand('show')
    const overrides = showResult.overrides as Record<string, unknown>
    const mcp = overrides['mcp'] as Record<string, unknown> | undefined
    expect(mcp?.['browserEnabled']).toBe(false)
  })

  test('set writes a number override', () => {
    const result = handleConfigCommand('set quota.retryMax=5')
    expect(result.ok).toBe(true)

    const showResult = handleConfigCommand('show')
    const overrides = showResult.overrides as Record<string, unknown>
    const quota = overrides['quota'] as Record<string, unknown> | undefined
    expect(quota?.['retryMax']).toBe(5)
  })

  test('set without value returns error', () => {
    const result = handleConfigCommand('set')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('usage')
  })

  test('set with invalid format returns error', () => {
    const result = handleConfigCommand('set no-equals-sign')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid format')
  })

  test('unknown subcommand returns error', () => {
    const result = handleConfigCommand('bogus')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
