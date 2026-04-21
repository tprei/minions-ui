import type { CompletionHandler, HandlerCtx, SessionCompletedEvent, SessionMetadata } from './types'

export const pendingFeedbackHandler: CompletionHandler = {
  name: 'pending-feedback',
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
    const queue = ctx.replyQueue.forSession(ev.sessionId)
    const pending = await queue.drain()

    if (pending.length === 0) return

    const existing: string[] = Array.isArray(meta.pendingFeedback) ? meta.pendingFeedback : []
    const updatedMeta: SessionMetadata = { ...meta, pendingFeedback: [...existing, ...pending] }

    ctx.db.run(
      'UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(updatedMeta), Date.now(), ev.sessionId],
    )
  },
}
