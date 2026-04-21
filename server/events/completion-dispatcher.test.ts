import { describe, test, expect, beforeEach } from 'bun:test'
import { EngineEventBus, resetEventBus } from './bus'
import { CompletionDispatcher } from './completion-dispatcher'
import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from '../handlers/types'
import { Database } from 'bun:sqlite'
import { openDatabase, runMigrations } from '../db/sqlite'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from '../handlers/stubs'

function makeDb(): Database {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return db
}

function makeCtx(db: Database, bus: EngineEventBus): HandlerCtx {
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function makeEvent(sessionId = 'sess-1'): SessionCompletedEvent {
  return { kind: 'session.completed', sessionId, state: 'completed', durationMs: 100 }
}

function makeHandler(name: string, priority: number, callList: string[], matchResult = true): CompletionHandler {
  return {
    name,
    priority,
    matches: () => matchResult,
    handle: async () => {
      callList.push(name)
    },
  }
}

describe('CompletionDispatcher', () => {
  let bus: EngineEventBus
  let db: Database
  let ctx: HandlerCtx

  beforeEach(() => {
    resetEventBus()
    bus = new EngineEventBus()
    db = makeDb()
    ctx = makeCtx(db, bus)
  })

  test('runs handlers in priority order (lowest int first)', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('c', 30, calls))
    dispatcher.register(makeHandler('a', 10, calls))
    dispatcher.register(makeHandler('b', 20, calls))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toEqual(['a', 'b', 'c'])
  })

  test('skips handlers where matches() returns false', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('skip', 10, calls, false))
    dispatcher.register(makeHandler('run', 20, calls, true))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toEqual(['run'])
  })

  test('error in one handler does not abort subsequent handlers', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    const failingHandler: CompletionHandler = {
      name: 'fail',
      priority: 10,
      matches: () => true,
      handle: async () => {
        throw new Error('intentional failure')
      },
    }

    dispatcher.register(failingHandler)
    dispatcher.register(makeHandler('after', 20, calls))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toEqual(['after'])
  })

  test('only processes events for session.completed kind', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)
    dispatcher.register(makeHandler('h', 10, calls))

    bus.emit({ kind: 'session.started', sessionId: 'sess-1', pid: 1 })
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toEqual([])
  })

  test('processes multiple completion events independently', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    const handler: CompletionHandler = {
      name: 'recorder',
      priority: 10,
      matches: () => true,
      handle: async (ev) => {
        calls.push(ev.sessionId)
      },
    }
    dispatcher.register(handler)

    bus.emit(makeEvent('sess-a'))
    bus.emit(makeEvent('sess-b'))
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toContain('sess-a')
    expect(calls).toContain('sess-b')
  })

  test('priority ordering is maintained after out-of-order registration', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('z', 100, calls))
    dispatcher.register(makeHandler('a', 1, calls))
    dispatcher.register(makeHandler('m', 50, calls))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 20))

    expect(calls).toEqual(['a', 'm', 'z'])
  })
})
