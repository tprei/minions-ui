import { describe, test, expect } from 'bun:test'
import { HANDLER_PRIORITIES } from './priorities'
import { pendingFeedbackHandler } from './pending-feedback-handler'
import { parentNotifyHandler } from './parent-notify-handler'
import { qualityGateHandler } from './quality-gate-handler'
import { digestHandler } from './digest-handler'
import { ciBabysitHandler } from './ci-babysit-handler'
import { statsHandler } from './stats-handler'
import { restackResolverHandler } from './restack-resolver-handler'
import { quotaHandler } from './quota-handler'
import { shipAdvanceHandler } from './ship-advance-handler'
import { modeCompletionHandler } from './mode-completion-handler'
import { loopCompletionHandler } from './loop-completion-handler'
import { taskCompletionHandler } from './task-completion-handler'
import type { CompletionHandler } from './types'

describe('HANDLER_PRIORITIES', () => {
  test('tier values follow the documented spacing', () => {
    expect(HANDLER_PRIORITIES.OBSERVE).toBe(0)
    expect(HANDLER_PRIORITIES.RECORD).toBe(10)
    expect(HANDLER_PRIORITIES.RETRY).toBe(20)
    expect(HANDLER_PRIORITIES.ADVANCE).toBe(30)
    expect(HANDLER_PRIORITIES.EMIT_MODE).toBe(40)
    expect(HANDLER_PRIORITIES.LOOP).toBe(50)
    expect(HANDLER_PRIORITIES.TASK).toBe(60)
  })

  test('tiers are strictly ascending with 10 spacing', () => {
    const tiers = [
      HANDLER_PRIORITIES.OBSERVE,
      HANDLER_PRIORITIES.RECORD,
      HANDLER_PRIORITIES.RETRY,
      HANDLER_PRIORITIES.ADVANCE,
      HANDLER_PRIORITIES.EMIT_MODE,
      HANDLER_PRIORITIES.LOOP,
      HANDLER_PRIORITIES.TASK,
    ]
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]).toBeGreaterThan(tiers[i - 1] as number)
      expect((tiers[i] as number) - (tiers[i - 1] as number)).toBe(10)
    }
  })

  test('OBSERVE < RECORD < RETRY < ADVANCE < EMIT_MODE < LOOP < TASK', () => {
    expect(HANDLER_PRIORITIES.OBSERVE).toBeLessThan(HANDLER_PRIORITIES.RECORD)
    expect(HANDLER_PRIORITIES.RECORD).toBeLessThan(HANDLER_PRIORITIES.RETRY)
    expect(HANDLER_PRIORITIES.RETRY).toBeLessThan(HANDLER_PRIORITIES.ADVANCE)
    expect(HANDLER_PRIORITIES.ADVANCE).toBeLessThan(HANDLER_PRIORITIES.EMIT_MODE)
    expect(HANDLER_PRIORITIES.EMIT_MODE).toBeLessThan(HANDLER_PRIORITIES.LOOP)
    expect(HANDLER_PRIORITIES.LOOP).toBeLessThan(HANDLER_PRIORITIES.TASK)
  })
})

describe('handler priority assignments', () => {
  test('OBSERVE-tier handlers use HANDLER_PRIORITIES.OBSERVE', () => {
    expect(pendingFeedbackHandler.priority).toBe(HANDLER_PRIORITIES.OBSERVE)
    expect(parentNotifyHandler.priority).toBe(HANDLER_PRIORITIES.OBSERVE)
    expect(qualityGateHandler.priority).toBe(HANDLER_PRIORITIES.OBSERVE)
    expect(digestHandler.priority).toBe(HANDLER_PRIORITIES.OBSERVE)
    expect(ciBabysitHandler.priority).toBe(HANDLER_PRIORITIES.OBSERVE)
  })

  test('RECORD-tier handlers use HANDLER_PRIORITIES.RECORD', () => {
    expect(statsHandler.priority).toBe(HANDLER_PRIORITIES.RECORD)
    expect(restackResolverHandler.priority).toBe(HANDLER_PRIORITIES.RECORD)
  })

  test('quota uses RETRY tier', () => {
    expect(quotaHandler.priority).toBe(HANDLER_PRIORITIES.RETRY)
  })

  test('ship-advance uses ADVANCE tier', () => {
    expect(shipAdvanceHandler.priority).toBe(HANDLER_PRIORITIES.ADVANCE)
  })

  test('mode-completion uses EMIT_MODE tier', () => {
    expect(modeCompletionHandler.priority).toBe(HANDLER_PRIORITIES.EMIT_MODE)
  })

  test('loop-completion uses LOOP tier', () => {
    expect(loopCompletionHandler.priority).toBe(HANDLER_PRIORITIES.LOOP)
  })

  test('task-completion uses TASK tier', () => {
    expect(taskCompletionHandler.priority).toBe(HANDLER_PRIORITIES.TASK)
  })
})

describe('handler ordering invariants', () => {
  test('parent-notify fires before quota retry and ship advance', () => {
    expect(parentNotifyHandler.priority).toBeLessThan(quotaHandler.priority)
    expect(parentNotifyHandler.priority).toBeLessThan(shipAdvanceHandler.priority)
  })

  test('quota retry fires before ship advance', () => {
    expect(quotaHandler.priority).toBeLessThan(shipAdvanceHandler.priority)
  })

  test('ship advance fires before mode completion event emission', () => {
    expect(shipAdvanceHandler.priority).toBeLessThan(modeCompletionHandler.priority)
  })

  test('mode completion fires before loop bookkeeping', () => {
    expect(modeCompletionHandler.priority).toBeLessThan(loopCompletionHandler.priority)
  })

  test('all single-purpose handlers fire before task composite', () => {
    const composite = taskCompletionHandler.priority
    const singlePurpose: CompletionHandler[] = [
      pendingFeedbackHandler,
      parentNotifyHandler,
      qualityGateHandler,
      digestHandler,
      ciBabysitHandler,
      statsHandler,
      restackResolverHandler,
      quotaHandler,
      shipAdvanceHandler,
      modeCompletionHandler,
      loopCompletionHandler,
    ]
    for (const h of singlePurpose) {
      expect(h.priority).toBeLessThan(composite)
    }
  })

  test('sorting registered handlers produces the expected execution order', () => {
    const handlers: CompletionHandler[] = [
      taskCompletionHandler,
      shipAdvanceHandler,
      pendingFeedbackHandler,
      modeCompletionHandler,
      quotaHandler,
      statsHandler,
      loopCompletionHandler,
      parentNotifyHandler,
    ]
    const sorted = [...handlers].sort((a, b) => a.priority - b.priority)
    const orderedNames = sorted.map((h) => h.name)
    expect(orderedNames).toEqual([
      'pending-feedback',
      'parent-notify',
      'stats',
      'quota',
      'ship-advance',
      'mode-completion',
      'loop-completion',
      'task-completion',
    ])
  })
})
