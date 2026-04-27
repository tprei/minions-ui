import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from './types'
import { qualityGateHandler } from './quality-gate-handler'
import { digestHandler } from './digest-handler'
import { ciBabysitHandler } from './ci-babysit-handler'

export const taskCompletionHandler: CompletionHandler = {
  name: 'task-completion',
  priority: 60,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ mode: string }, [string]>('SELECT mode FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }
    if (row.mode !== 'task') return { handled: false, reason: 'mode_mismatch' }

    await qualityGateHandler.handle(ev, ctx)
    await digestHandler.handle(ev, ctx)
    await ciBabysitHandler.handle(ev, ctx)
    return { handled: true }
  },
}
