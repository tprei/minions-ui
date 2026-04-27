import { describe, test, expect } from 'bun:test'
import { handleForceCommand } from './force'
import type { DagScheduler } from '../dag/scheduler'

function makeScheduler(shouldFail = false): DagScheduler {
  return {
    async start() {},
    async onSessionCompleted() {},
    async onSessionResumed() {},
    async cancel() {},
    status() { return { dagId: '', nodes: [] } },
    async retryNode() {},
    async forceNodeLanded(nodeId, dagId) {
      if (shouldFail) throw new Error(`cannot force ${nodeId} in ${dagId}`)
    },
    async reconcileOnBoot() {},
    persistDag() {},
    async watchdogTick() {},
    shutdown() {},
  }
}

describe('handleForceCommand', () => {
  test('success returns ok=true', async () => {
    const result = await handleForceCommand('node-1', 'dag-1', { scheduler: makeScheduler() })
    expect(result.ok).toBe(true)
  })

  test('missing nodeId returns error', async () => {
    const result = await handleForceCommand('', 'dag-1', { scheduler: makeScheduler() })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nodeId')
  })

  test('missing dagId returns error', async () => {
    const result = await handleForceCommand('node-1', '', { scheduler: makeScheduler() })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('dagId')
  })

  test('scheduler error propagates', async () => {
    const result = await handleForceCommand('n', 'd', { scheduler: makeScheduler(true) })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot force')
  })
})
