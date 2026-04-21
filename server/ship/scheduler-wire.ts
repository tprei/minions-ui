import type { CompletionDispatcher } from '../events/completion-dispatcher'
import { shipAdvanceHandler } from '../handlers/ship-advance-handler'
import type { SessionCompletedEvent } from '../handlers/types'

const shipOnlyHandler = {
  ...shipAdvanceHandler,
  matches(ev: SessionCompletedEvent): boolean {
    return shipAdvanceHandler.matches(ev)
  },
}

export function wireShipAdvance(dispatcher: CompletionDispatcher): void {
  dispatcher.register(shipOnlyHandler)
}
