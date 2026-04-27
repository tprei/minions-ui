import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent, SessionMetadata } from './types'
import { HANDLER_PRIORITIES } from './priorities'


export const loopCompletionHandler: CompletionHandler = {
  name: 'loop-completion',
  priority: HANDLER_PRIORITIES.LOOP,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }

    const meta = JSON.parse(row.metadata) as SessionMetadata
    if (!meta.loopId) return { handled: false, reason: 'not_a_loop_session' }

    await ctx.loopScheduler.recordOutcome(meta.loopId, ev.state)
    await ctx.registry.close(ev.sessionId)
    return { handled: true }
  },
}
