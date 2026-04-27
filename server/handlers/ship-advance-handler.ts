import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from './types'
import { handleExecute } from '../commands/plan-actions'

const SHIP_ADVANCE_MODES = new Set(['ship-think', 'ship-plan'])

export const shipAdvanceHandler: CompletionHandler = {
  name: 'ship-advance',
  priority: 30,

  matches(ev: SessionCompletedEvent): boolean {
    return ev.state === 'completed'
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ mode: string; pipeline_advancing: number }, [string]>(
        'SELECT mode, pipeline_advancing FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row || !SHIP_ADVANCE_MODES.has(row.mode)) {
      return { handled: false, reason: row ? 'mode_mismatch' : 'session_not_found' }
    }
    if (row.pipeline_advancing !== 0) return { handled: false, reason: 'already_advancing' }

    try {
      await handleExecute(ev.sessionId, {
        db: ctx.db,
        registry: ctx.registry,
        scheduler: ctx.scheduler,
      })
    } catch (err) {
      console.error(`[ship-advance] failed to advance session ${ev.sessionId} (mode=${row.mode}):`, err)
      throw err
    }
    return { handled: true }
  },
}
