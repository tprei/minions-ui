import type { EngineEventBus } from '../events/bus'
import type { HandlerCtx } from '../handlers/types'
import { loopCompletionHandler } from '../handlers/loop-completion-handler'
import type { LoopScheduler } from './scheduler'

export function wireLoopCompletion(
  bus: EngineEventBus,
  ctx: HandlerCtx,
  loopScheduler: LoopScheduler,
): void {
  const patchedCtx: HandlerCtx = { ...ctx, loopScheduler }

  bus.onKind('session.completed', (ev) => {
    if (!loopCompletionHandler.matches(ev)) return
    void loopCompletionHandler.handle(ev, patchedCtx)
  })
}
