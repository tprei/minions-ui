import type { DagScheduler } from '../dag/scheduler'

export interface ForceCommandCtx {
  scheduler: DagScheduler
}

export interface ForceCommandResult {
  ok: boolean
  error?: string
}

export async function handleForceCommand(
  nodeId: string,
  dagId: string,
  ctx: ForceCommandCtx,
): Promise<ForceCommandResult> {
  if (!nodeId) return { ok: false, error: 'nodeId required' }
  if (!dagId) return { ok: false, error: 'dagId required' }
  try {
    await ctx.scheduler.forceNodeLanded(nodeId, dagId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
