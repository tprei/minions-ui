import type { DagScheduler } from '../dag/scheduler'

export interface RetryCommandCtx {
  scheduler: DagScheduler
}

export interface RetryCommandResult {
  ok: boolean
  error?: string
}

export async function handleRetryCommand(
  nodeId: string,
  dagId: string,
  ctx: RetryCommandCtx,
): Promise<RetryCommandResult> {
  if (!nodeId) return { ok: false, error: 'nodeId required' }
  if (!dagId) return { ok: false, error: 'dagId required' }
  try {
    await ctx.scheduler.retryNode(nodeId, dagId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
