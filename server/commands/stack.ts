import type { PlanActionCtx, PlanActionResult } from './plan-actions'
import { handleStack as _handleStack } from './plan-actions'

export async function handleStackCommand(
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  return _handleStack(sessionId, ctx)
}
