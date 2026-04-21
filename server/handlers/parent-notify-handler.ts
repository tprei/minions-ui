import type { CompletionHandler, HandlerCtx, SessionCompletedEvent, SessionMetadata } from './types'

export const parentNotifyHandler: CompletionHandler = {
  name: 'parent-notify',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return

    const meta = JSON.parse(row.metadata) as SessionMetadata
    if (!meta.dagNodeId) return

    await ctx.scheduler.onSessionCompleted(ev.sessionId, ev.state)
  },
}
