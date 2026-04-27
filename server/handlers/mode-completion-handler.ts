import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from './types'

export const modeCompletionHandler: CompletionHandler = {
  name: 'mode-completion',
  priority: 40,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ mode: string }, [string]>('SELECT mode FROM sessions WHERE id = ?')
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }

    ctx.bus.emit({
      kind: 'session.mode_completed',
      sessionId: ev.sessionId,
      mode: row.mode,
      state: ev.state,
      durationMs: ev.durationMs,
    })
    return { handled: true }
  },
}
