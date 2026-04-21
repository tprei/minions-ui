import type { PlanActionCtx, PlanActionResult } from './plan-actions'
import { handleSplit as _handleSplit } from './plan-actions'

export async function handleSplitCommand(
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  return _handleSplit(sessionId, ctx)
}
