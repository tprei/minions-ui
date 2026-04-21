import { describe, test, expect } from 'bun:test'
import { applyOverrides, requiresRestart } from './apply'
import type { LoopRuntime } from './apply'

function makeLoopRuntime(): LoopRuntime & {
  calls: Array<{ method: string; args: unknown[] }>
} {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    calls,
    setInterval(id: string, ms: number) { calls.push({ method: 'setInterval', args: [id, ms] }) },
    enable(id: string) { calls.push({ method: 'enable', args: [id] }) },
    disable(id: string) { calls.push({ method: 'disable', args: [id] }) },
  }
}

describe('applyOverrides', () => {
  test('returns empty requiresRestart when no restart fields set', () => {
    const result = applyOverrides({})
    expect(result.requiresRestart).toEqual([])
  })

  test('calls setInterval on loopRuntime for loop intervalMs', () => {
    const runtime = makeLoopRuntime()
    applyOverrides({ loops: { 'test-coverage': { intervalMs: 5000 } } }, runtime)
    expect(runtime.calls).toContainEqual({ method: 'setInterval', args: ['test-coverage', 5000] })
  })

  test('calls disable on loopRuntime when enabled=false', () => {
    const runtime = makeLoopRuntime()
    applyOverrides({ loops: { 'dead-code': { enabled: false } } }, runtime)
    expect(runtime.calls).toContainEqual({ method: 'disable', args: ['dead-code'] })
  })

  test('calls enable on loopRuntime when enabled=true', () => {
    const runtime = makeLoopRuntime()
    applyOverrides({ loops: { 'dead-code': { enabled: true } } }, runtime)
    expect(runtime.calls).toContainEqual({ method: 'enable', args: ['dead-code'] })
  })

  test('does not call loop runtime methods when no loops in overrides', () => {
    const runtime = makeLoopRuntime()
    applyOverrides({ quota: { retryMax: 3 } }, runtime)
    expect(runtime.calls).toHaveLength(0)
  })

  test('flags workspace.maxConcurrentSessions as requiresRestart', () => {
    const result = applyOverrides({ workspace: { maxConcurrentSessions: 4 } })
    expect(result.requiresRestart).toContain('workspace.maxConcurrentSessions')
  })

  test('flags loopsConfig.maxConcurrentLoops as requiresRestart', () => {
    const result = applyOverrides({ loopsConfig: { maxConcurrentLoops: 2 } })
    expect(result.requiresRestart).toContain('loopsConfig.maxConcurrentLoops')
  })

  test('does not flag workspace when maxConcurrentSessions undefined', () => {
    const result = applyOverrides({ workspace: {} })
    expect(result.requiresRestart).not.toContain('workspace.maxConcurrentSessions')
  })

  test('handles both restart and live changes together', () => {
    const runtime = makeLoopRuntime()
    const result = applyOverrides(
      {
        loops: { 'test-coverage': { intervalMs: 3600000 } },
        workspace: { maxConcurrentSessions: 2 },
      },
      runtime,
    )
    expect(result.requiresRestart).toContain('workspace.maxConcurrentSessions')
    expect(runtime.calls).toContainEqual({ method: 'setInterval', args: ['test-coverage', 3600000] })
  })
})

describe('requiresRestart', () => {
  test('returns only restart-flagged fields', () => {
    const result = requiresRestart(['workspace', 'quota'])
    expect(result).toContain('workspace')
    expect(result).not.toContain('quota')
  })

  test('returns loopsConfig as restart field', () => {
    const result = requiresRestart(['loopsConfig', 'loops'])
    expect(result).toContain('loopsConfig')
    expect(result).not.toContain('loops')
  })

  test('returns empty array for no restart fields', () => {
    const result = requiresRestart(['loops', 'mcp', 'quota'])
    expect(result).toEqual([])
  })
})
