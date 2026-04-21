import type { EngineEventBus } from './bus'
import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from '../handlers/types'

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
      try {
        await handler.handle(ev, this.ctx)
      } catch (err) {
        console.error(`[completion-dispatcher] handler "${handler.name}" failed for session ${ev.sessionId}:`, err)
      }
    }
  }
}
