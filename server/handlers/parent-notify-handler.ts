import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent, SessionMetadata } from './types'

export const parentNotifyHandler: CompletionHandler = {
  name: 'parent-notify',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }

    const meta = JSON.parse(row.metadata) as SessionMetadata
    if (!meta.dagNodeId) return { handled: false, reason: 'not_a_dag_node' }

    await ctx.scheduler.onSessionCompleted(ev.sessionId, ev.state)
    return { handled: true }
  },
}
