import type { LandingManager } from '../dag/landing'
import type { Database } from 'bun:sqlite'
import { loadDag } from '../dag/store'

export interface LandCommandCtx {
  landingManager: LandingManager
  db: Database
}

export interface LandCommandResult {
  ok: boolean
  prUrl?: string
  error?: string
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

  const result = await ctx.landingManager.landNode(nodeId, graph)
  return { ok: result.ok, prUrl: result.prUrl, error: result.error }
}
