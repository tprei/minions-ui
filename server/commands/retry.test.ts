import { describe, test, expect } from 'bun:test'
import { handleRetryCommand } from './retry'
import type { DagScheduler } from '../dag/scheduler'

function makeScheduler(shouldFail = false): DagScheduler {
  return {
    async start() {},
    async onSessionCompleted() {},
    async onSessionResumed() {},
    async cancel() {},
    status() { return { dagId: '', nodes: [] } },
    async retryNode(nodeId, dagId) {
      if (shouldFail) throw new Error(`cannot retry ${nodeId} in ${dagId}`)
    },
    async forceNodeLanded() {},
    async reconcileOnBoot() {},
    persistDag() {},
  }
}

describe('handleRetryCommand', () => {
  test('success returns ok=true', async () => {
    const result = await handleRetryCommand('node-1', 'dag-1', { scheduler: makeScheduler() })
    expect(result.ok).toBe(true)
  })

  test('missing nodeId returns error', async () => {
    const result = await handleRetryCommand('', 'dag-1', { scheduler: makeScheduler() })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nodeId')
  })

  test('missing dagId returns error', async () => {
    const result = await handleRetryCommand('node-1', '', { scheduler: makeScheduler() })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('dagId')
  })

  test('scheduler error propagates', async () => {
    const result = await handleRetryCommand('node-1', 'dag-1', { scheduler: makeScheduler(true) })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot retry')
  })
})
