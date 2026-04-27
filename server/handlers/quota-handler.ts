import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from './types'

const QUOTA_RETRY_MAX_DEFAULT = 3

export const quotaHandler: CompletionHandler = {
  name: 'quota',
  priority: 20,

  matches(ev: SessionCompletedEvent): boolean {
    return ev.state === 'quota_exhausted'
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const maxRetries = ctx.config.quotaRetryMax ?? QUOTA_RETRY_MAX_DEFAULT

    const row = ctx.db
      .query<{ quota_retry_count: number }, [string]>(
        'SELECT quota_retry_count FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    const retryCount = (row?.quota_retry_count ?? 0) + 1

    if (retryCount > maxRetries) {
      return { handled: false, reason: 'retry_count_exceeded' }
    }

    const resetAt = Date.now() + 60_000

    ctx.db.run(
      `UPDATE sessions SET quota_sleep_until = ?, quota_retry_count = ?, updated_at = ? WHERE id = ?`,
      [resetAt, retryCount, Date.now(), ev.sessionId],
    )

    await ctx.registry.scheduleQuotaResume(ev.sessionId, resetAt)
    return { handled: true, reason: 'quota_resume_scheduled' }
  },
}
