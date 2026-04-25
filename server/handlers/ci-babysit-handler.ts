import type { CompletionHandler, HandlerCtx, SessionCompletedEvent, SessionMetadata } from './types'
import { prepared } from '../db/sqlite'

export const ciBabysitHandler: CompletionHandler = {
  name: 'ci-babysit',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ pr_url: string | null; metadata: string }, [string]>(
        'SELECT pr_url, metadata FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row?.pr_url) return

    let meta: SessionMetadata
    try {
      meta = JSON.parse(row.metadata) as SessionMetadata
    } catch {
      meta = {}
    }
    if (meta.ciBabysitStartedAt) return

    const now = Date.now()
    meta.ciBabysitStartedAt = now
    meta.ciBabysitTrigger = 'completion'
    prepared.updateSession(ctx.db, {
      id: ev.sessionId,
      metadata: { ...meta },
      updated_at: now,
    })

    if (meta.parentThreadId) {
      await ctx.ciBabysitter.queueDeferredBabysit(ev.sessionId, meta.parentThreadId)
    } else {
      await ctx.ciBabysitter.babysitPR(ev.sessionId, row.pr_url)
    }
  },
}
