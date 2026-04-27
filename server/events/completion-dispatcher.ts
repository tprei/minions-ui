import type { EngineEventBus } from './bus'
import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from '../handlers/types'

export class CompletionDispatcher {
  private readonly handlers: CompletionHandler[] = []
  private readonly ctx: HandlerCtx

  constructor(bus: EngineEventBus, ctx: HandlerCtx) {
    this.ctx = ctx
    bus.onKind('session.completed', (ev) => {
      void this.dispatch(ev)
    })
  }

  register(handler: CompletionHandler): void {
    this.handlers.push(handler)
    this.handlers.sort((a, b) => a.priority - b.priority)
  }

  private async dispatch(ev: SessionCompletedEvent): Promise<void> {
    for (const handler of this.handlers) {
      if (!handler.matches(ev)) continue

      const startedAt = Date.now()
      let result: HandlerResult = { handled: false }
      let error: string | undefined

      try {
        result = await handler.handle(ev, this.ctx)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        console.error(`[completion-dispatcher] handler "${handler.name}" failed for session ${ev.sessionId}:`, err)
      }

      const durationMs = Date.now() - startedAt
      const stopPropagation = result.stopPropagation === true

      this.ctx.bus.emit({
        kind: 'handler.invoked',
        sessionId: ev.sessionId,
        handlerName: handler.name,
        priority: handler.priority,
        handled: result.handled === true,
        stopPropagation,
        durationMs,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(error !== undefined ? { error } : {}),
      })

      if (stopPropagation) break
    }
  }
}
