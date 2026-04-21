import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from './types'

export const statsHandler: CompletionHandler = {
  name: 'stats',
  priority: 10,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ slug: string; mode: string; repo: string | null }, [string]>(
        'SELECT slug, mode, repo FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row) return

    ctx.db.run(
      `INSERT INTO session_stats (session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ev.sessionId,
        row.slug,
        row.repo,
        row.mode,
        ev.state,
        ev.durationMs,
        ev.totalTokens ?? null,
        Date.now(),
      ],
    )
  },
}
