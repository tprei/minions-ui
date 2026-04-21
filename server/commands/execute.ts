import type { PlanActionCtx, PlanActionResult } from './plan-actions'
import { handleExecute as _handleExecute } from './plan-actions'

export async function handleExecuteCommand(
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  return _handleExecute(sessionId, ctx)
}
