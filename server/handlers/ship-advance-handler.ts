import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from './types'

export const shipAdvanceHandler: CompletionHandler = {
  name: 'ship-advance',
  priority: 30,

  matches(ev: SessionCompletedEvent): boolean {
    return ev.state === 'completed'
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ mode: string; pipeline_advancing: number }, [string]>(
        'SELECT mode, pipeline_advancing FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row || !row.mode.startsWith('ship-')) return
    if (row.pipeline_advancing !== 0) return

    ctx.db.run(
      'UPDATE sessions SET pipeline_advancing = 1, updated_at = ? WHERE id = ?',
      [Date.now(), ev.sessionId],
    )

    try {
      await ctx.scheduler.onSessionCompleted(ev.sessionId, ev.state)
    } finally {
      ctx.db.run(
        'UPDATE sessions SET pipeline_advancing = 0, updated_at = ? WHERE id = ?',
        [Date.now(), ev.sessionId],
      )
    }
  },
}
