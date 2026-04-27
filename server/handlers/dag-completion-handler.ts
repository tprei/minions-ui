import type { Database } from 'bun:sqlite'
import type { EngineEventBus } from '../events/bus'
import type { EngineEventOfKind } from '../events/types'
import type { SessionRegistry } from '../session/registry'
import { advanceShip } from '../ship/coordinator'

export interface DagCompletionHandlerCtx {
  db: Database
  registry: SessionRegistry
  scheduler: { start(dagId: string): Promise<void> }
}

export type DagCompletedEvent = EngineEventOfKind<'dag.completed'>

export async function handleDagCompletion(
  event: DagCompletedEvent,
  ctx: DagCompletionHandlerCtx,
): Promise<void> {
  try {
    await advanceShip(event.rootSessionId, 'verify', ctx)
  } catch (err) {
    console.error(`[dag-completion] failed to advance ship for dag ${event.dagId}:`, err)
  }
}

export function registerDagCompletionHandler(
  bus: EngineEventBus,
  ctx: DagCompletionHandlerCtx,
): () => void {
  return bus.onKind('dag.completed', (event) => {
    void handleDagCompletion(event, ctx)
  })
}
