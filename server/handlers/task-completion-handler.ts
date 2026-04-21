import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from './types'
import { qualityGateHandler } from './quality-gate-handler'
import { digestHandler } from './digest-handler'
import { ciBabysitHandler } from './ci-babysit-handler'

export const taskCompletionHandler: CompletionHandler = {
  name: 'task-completion',
  priority: 60,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ mode: string }, [string]>('SELECT mode FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row || row.mode !== 'task') return

    await qualityGateHandler.handle(ev, ctx)
    await digestHandler.handle(ev, ctx)
    await ciBabysitHandler.handle(ev, ctx)
  },
}
