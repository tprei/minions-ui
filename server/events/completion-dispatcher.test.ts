import { describe, test, expect, beforeEach } from 'bun:test'
import { EngineEventBus, resetEventBus } from './bus'
import { CompletionDispatcher } from './completion-dispatcher'
import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from '../handlers/types'
import type { EngineEvent, EngineEventOfKind } from './types'
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

function makeHandler(
  name: string,
  priority: number,
  callList: string[],
  matchResult = true,
  result: HandlerResult = { handled: true },
): CompletionHandler {
  return {
    name,
    priority,
    matches: () => matchResult,
    handle: async () => {
      callList.push(name)
      return result
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
      handle: async (): Promise<HandlerResult> => {
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
      handle: async (ev): Promise<HandlerResult> => {
        calls.push(ev.sessionId)
        return { handled: true }
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

  test('emits handler.invoked for each handler that matches', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('a', 10, calls, true, { handled: true, reason: 'ok' }))
    dispatcher.register(makeHandler('b', 20, calls, true, { handled: false, reason: 'skipped' }))
    dispatcher.register(makeHandler('c', 30, calls, false))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent('sess-x'))
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(invoked).toHaveLength(2)
    expect(invoked.map((e) => e.handlerName)).toEqual(['a', 'b'])

    expect(invoked[0]!.sessionId).toBe('sess-x')
    expect(invoked[0]!.priority).toBe(10)
    expect(invoked[0]!.handled).toBe(true)
    expect(invoked[0]!.stopPropagation).toBe(false)
    expect(invoked[0]!.reason).toBe('ok')
    expect(invoked[0]!.error).toBeUndefined()
    expect(typeof invoked[0]!.durationMs).toBe('number')
    expect(invoked[0]!.durationMs).toBeGreaterThanOrEqual(0)

    expect(invoked[1]!.handlerName).toBe('b')
    expect(invoked[1]!.handled).toBe(false)
    expect(invoked[1]!.reason).toBe('skipped')
  })

  test('stopPropagation halts subsequent handlers and is recorded', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('a', 10, calls, true, { handled: true }))
    dispatcher.register(
      makeHandler('stop', 20, calls, true, { handled: true, stopPropagation: true, reason: 'claimed' }),
    )
    dispatcher.register(makeHandler('after', 30, calls, true, { handled: true }))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(calls).toEqual(['a', 'stop'])
    expect(invoked.map((e) => e.handlerName)).toEqual(['a', 'stop'])
    expect(invoked[1]!.stopPropagation).toBe(true)
    expect(invoked[1]!.reason).toBe('claimed')
  })

  test('emits handler.invoked with error field when handler throws', async () => {
    const dispatcher = new CompletionDispatcher(bus, ctx)

    const failingHandler: CompletionHandler = {
      name: 'fail',
      priority: 10,
      matches: () => true,
      handle: async (): Promise<HandlerResult> => {
        throw new Error('boom')
      },
    }
    dispatcher.register(failingHandler)
    dispatcher.register(makeHandler('after', 20, [], true, { handled: true }))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent('sess-err'))
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(invoked).toHaveLength(2)
    const failEv = invoked.find((e) => e.handlerName === 'fail')!
    expect(failEv.handled).toBe(false)
    expect(failEv.stopPropagation).toBe(false)
    expect(failEv.error).toBe('boom')
    expect(failEv.sessionId).toBe('sess-err')

    const afterEv = invoked.find((e) => e.handlerName === 'after')!
    expect(afterEv.handled).toBe(true)
    expect(afterEv.error).toBeUndefined()
  })

  test('does not emit handler.invoked when matches() is false', async () => {
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('nomatch', 10, [], false))
    dispatcher.register(makeHandler('match', 20, [], true, { handled: true }))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(invoked.map((e) => e.handlerName)).toEqual(['match'])
  })

  test('handler.invoked events are session.completed-correlated', async () => {
    const dispatcher = new CompletionDispatcher(bus, ctx)
    dispatcher.register(makeHandler('one', 10, [], true, { handled: true }))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent('sess-a'))
    bus.emit(makeEvent('sess-b'))
    await new Promise<void>((r) => setTimeout(r, 30))

    const sessionIds = invoked.map((e) => e.sessionId).sort()
    expect(sessionIds).toEqual(['sess-a', 'sess-b'])
  })

  test('integration: real handler chain emits a handler.invoked per match (no handler claimed scenario)', async () => {
    const calls: string[] = []
    const dispatcher = new CompletionDispatcher(bus, ctx)

    dispatcher.register(makeHandler('one', 10, calls, true, { handled: false, reason: 'session_not_found' }))
    dispatcher.register(makeHandler('two', 20, calls, true, { handled: false, reason: 'mode_mismatch' }))

    const invoked: EngineEventOfKind<'handler.invoked'>[] = []
    bus.onKind('handler.invoked', (e) => invoked.push(e))

    bus.emit(makeEvent('orphan-session'))
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(invoked).toHaveLength(2)
    expect(invoked.every((e) => e.handled === false)).toBe(true)
    const reasons = invoked.map((e) => e.reason)
    expect(reasons).toEqual(['session_not_found', 'mode_mismatch'])
  })

  test('does not double-emit handler.invoked back into the dispatcher', async () => {
    const dispatcher = new CompletionDispatcher(bus, ctx)
    const calls: string[] = []
    dispatcher.register(makeHandler('one', 10, calls, true, { handled: true }))

    const allEvents: EngineEvent[] = []
    bus.on((e) => allEvents.push(e))

    bus.emit(makeEvent())
    await new Promise<void>((r) => setTimeout(r, 30))

    expect(calls).toEqual(['one'])
    const invokedCount = allEvents.filter((e) => e.kind === 'handler.invoked').length
    expect(invokedCount).toBe(1)
  })
})
