import type { CompletionHandler, HandlerCtx, SessionCompletedEvent, SessionMetadata } from './types'

export const loopCompletionHandler: CompletionHandler = {
  name: 'loop-completion',
  priority: 50,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return

    const meta = JSON.parse(row.metadata) as SessionMetadata
    if (!meta.loopId) return

    await ctx.loopScheduler.recordOutcome(meta.loopId, ev.state)
    await ctx.registry.close(ev.sessionId)
  },
}
