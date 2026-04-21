import type { PlanActionCtx, PlanActionResult } from './plan-actions'
import { handleDag as _handleDag } from './plan-actions'

export async function handleDagCommand(
  markdown: string,
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  return _handleDag(markdown, sessionId, ctx)
}
