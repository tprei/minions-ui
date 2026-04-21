import { EventEmitter } from 'node:events'
import type { EngineEvent, EngineEventKind, EngineEventOfKind } from './types'

const CHANNEL = 'engine.event'

export class EngineEventBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  emit(event: EngineEvent): void {
    this.emitter.emit(CHANNEL, event)
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.emitter.on(CHANNEL, listener)
    return () => {
      this.emitter.off(CHANNEL, listener)
    }
  }

  onKind<K extends EngineEventKind>(kind: K, listener: (event: EngineEventOfKind<K>) => void): () => void {
    const wrapped = (event: EngineEvent) => {
      if (event.kind === kind) listener(event as EngineEventOfKind<K>)
    }
    return this.on(wrapped)
  }
}

let singleton: EngineEventBus | null = null

export function getEventBus(): EngineEventBus {
  if (!singleton) singleton = new EngineEventBus()
  return singleton
}

export function resetEventBus(): void {
  singleton = null
}
