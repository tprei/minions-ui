import type { LandingManager, LandingMode } from '../dag/landing'
import type { Database } from 'bun:sqlite'
import { loadDag } from '../dag/store'

export interface LandCommandCtx {
  landingManager: LandingManager
  db: Database
  mode?: LandingMode
}

export interface LandCommandResult {
  ok: boolean
  prUrl?: string
  error?: string
  mode?: LandingMode
  rolledBack?: number
  rollbackFullySuccessful?: boolean
}

export async function handleLandCommand(
  nodeId: string,
  dagId: string,
  ctx: LandCommandCtx,
): Promise<LandCommandResult> {
  if (!nodeId) return { ok: false, error: 'nodeId required' }
  if (!dagId) return { ok: false, error: 'dagId required' }

  const graph = loadDag(dagId, ctx.db)
  if (!graph) return { ok: false, error: `DAG ${dagId} not found` }

  const mode = ctx.mode ?? 'best-effort'
  const sequence = await ctx.landingManager.landSequence([nodeId], graph, { mode })
  const landed = sequence.landed[0]
  const failed = sequence.failed[0]
  const rolledBack = sequence.rollback?.entries.filter((e) => e.reverted).length ?? 0

  return {
    ok: sequence.ok,
    prUrl: landed?.prUrl ?? failed?.prUrl,
    error: failed?.error,
    mode,
    ...(sequence.rollback ? { rolledBack, rollbackFullySuccessful: sequence.rollback.fullySuccessful } : {}),
  }
}
