import { describe, it, expect } from 'bun:test'
import {
  AdmissionDeniedError,
  createAdmissionController,
  priorityForMode,
  PRIORITY_ORDER,
} from './admission'

describe('priorityForMode', () => {
  it('classifies dag-task as dag-task', () => {
    expect(priorityForMode({ mode: 'dag-task' })).toBe('dag-task')
  })

  it('classifies ship at verify stage as ship-verify', () => {
    expect(priorityForMode({ mode: 'ship', stage: 'verify' })).toBe('ship-verify')
  })

  it('classifies ship without verify stage as ship-root', () => {
    expect(priorityForMode({ mode: 'ship' })).toBe('ship-root')
    expect(priorityForMode({ mode: 'ship', stage: 'plan' })).toBe('ship-root')
    expect(priorityForMode({ mode: 'ship', stage: 'dag' })).toBe('ship-root')
  })

  it('classifies sessions with loopId metadata as loop', () => {
    expect(priorityForMode({ mode: 'task', metadata: { loopId: 'test-coverage' } })).toBe('loop')
  })

  it('classifies task/plan/think/review/rebase-resolver as interactive', () => {
    expect(priorityForMode({ mode: 'task' })).toBe('interactive')
    expect(priorityForMode({ mode: 'plan' })).toBe('interactive')
    expect(priorityForMode({ mode: 'think' })).toBe('interactive')
    expect(priorityForMode({ mode: 'review' })).toBe('interactive')
    expect(priorityForMode({ mode: 'rebase-resolver' })).toBe('interactive')
  })

  it('does not treat metadata without a loopId string as loop', () => {
    expect(priorityForMode({ mode: 'task', metadata: {} })).toBe('interactive')
    expect(priorityForMode({ mode: 'task', metadata: { loopId: 42 as unknown as string } })).toBe('interactive')
  })
})

describe('AdmissionController', () => {
  it('admits up to totalCap when all priorities equal', () => {
    const ctrl = createAdmissionController({
      totalCap: 3,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    expect(ctrl.tryAdmit('s1', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('s2', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('s3', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('s4', 'loop').admitted).toBe(false)
  })

  it('reserves slots for higher priorities to prevent starvation by lower priorities', () => {
    const ctrl = createAdmissionController({
      totalCap: 5,
      reservedSlots: { interactive: 2, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })

    expect(ctrl.tryAdmit('l1', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('l2', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('l3', 'loop').admitted).toBe(true)
    const denied = ctrl.tryAdmit('l4', 'loop')
    expect(denied.admitted).toBe(false)
    expect(denied.reason).toContain('priority "loop"')
    expect(denied.reason).toContain('cap is 3')

    expect(ctrl.tryAdmit('i1', 'interactive').admitted).toBe(true)
    expect(ctrl.tryAdmit('i2', 'interactive').admitted).toBe(true)
    expect(ctrl.tryAdmit('i3', 'interactive').admitted).toBe(false)
  })

  it('releases slots so subsequent admissions succeed', () => {
    const ctrl = createAdmissionController({
      totalCap: 2,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })

    expect(ctrl.tryAdmit('a', 'dag-task').admitted).toBe(true)
    expect(ctrl.tryAdmit('b', 'dag-task').admitted).toBe(true)
    expect(ctrl.tryAdmit('c', 'dag-task').admitted).toBe(false)

    expect(ctrl.release('a')).toBe('dag-task')
    expect(ctrl.tryAdmit('c', 'dag-task').admitted).toBe(true)
  })

  it('release() returns undefined for unknown session id', () => {
    const ctrl = createAdmissionController({ totalCap: 4 })
    expect(ctrl.release('missing')).toBeUndefined()
  })

  it('tryAdmit is idempotent for the same session id', () => {
    const ctrl = createAdmissionController({ totalCap: 2 })
    const first = ctrl.tryAdmit('s1', 'interactive')
    expect(first.admitted).toBe(true)
    const second = ctrl.tryAdmit('s1', 'interactive')
    expect(second.admitted).toBe(true)
    expect(ctrl.stats().total).toBe(1)
  })

  it('peek does not mutate state', () => {
    const ctrl = createAdmissionController({
      totalCap: 2,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    expect(ctrl.peek('loop').admitted).toBe(true)
    expect(ctrl.stats().total).toBe(0)
  })

  it('peek reflects reserved slots for higher priorities', () => {
    const ctrl = createAdmissionController({
      totalCap: 3,
      reservedSlots: { interactive: 1, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    ctrl.tryAdmit('l1', 'loop')
    ctrl.tryAdmit('l2', 'loop')
    const peek = ctrl.peek('loop')
    expect(peek.admitted).toBe(false)
    expect(peek.capForPriority).toBe(2)
  })

  it('blocks lower priorities while preserving reservation for higher', () => {
    const ctrl = createAdmissionController({
      totalCap: 4,
      reservedSlots: { interactive: 2, 'ship-root': 1, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })

    expect(ctrl.tryAdmit('d1', 'dag-task').admitted).toBe(true)
    const denied = ctrl.tryAdmit('d2', 'dag-task')
    expect(denied.admitted).toBe(false)
    expect(denied.capForPriority).toBe(1)

    expect(ctrl.tryAdmit('s1', 'ship-root').admitted).toBe(true)
    expect(ctrl.tryAdmit('s2', 'ship-root').admitted).toBe(false)
    expect(ctrl.tryAdmit('i1', 'interactive').admitted).toBe(true)
    expect(ctrl.tryAdmit('i2', 'interactive').admitted).toBe(true)

    expect(ctrl.tryAdmit('i3', 'interactive').admitted).toBe(false)
  })

  it('ship-verify ranks below ship-root but above dag-task and loop', () => {
    const ctrl = createAdmissionController({
      totalCap: 3,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 1, 'dag-task': 0, loop: 0 },
    })

    expect(ctrl.tryAdmit('l1', 'loop').admitted).toBe(true)
    expect(ctrl.tryAdmit('l2', 'loop').admitted).toBe(true)
    const denied = ctrl.tryAdmit('l3', 'loop')
    expect(denied.admitted).toBe(false)
    expect(denied.capForPriority).toBe(2)

    expect(ctrl.tryAdmit('v1', 'ship-verify').admitted).toBe(true)
    expect(ctrl.tryAdmit('s1', 'ship-root').admitted).toBe(false)
  })

  it('stats reflect counts by priority', () => {
    const ctrl = createAdmissionController({ totalCap: 10 })
    ctrl.tryAdmit('a', 'interactive')
    ctrl.tryAdmit('b', 'dag-task')
    ctrl.tryAdmit('c', 'loop')
    const s = ctrl.stats()
    expect(s.total).toBe(3)
    expect(s.byPriority.interactive).toBe(1)
    expect(s.byPriority['dag-task']).toBe(1)
    expect(s.byPriority.loop).toBe(1)
  })

  it('reserve() pre-counts a session without re-checking caps', () => {
    const ctrl = createAdmissionController({
      totalCap: 1,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    ctrl.reserve('boot-1', 'interactive')
    expect(ctrl.stats().total).toBe(1)
    expect(ctrl.tryAdmit('next', 'interactive').admitted).toBe(false)
  })

  it('AdmissionDeniedError carries decision details', () => {
    const ctrl = createAdmissionController({
      totalCap: 1,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    ctrl.tryAdmit('a', 'loop')
    const decision = ctrl.tryAdmit('b', 'loop')
    const err = new AdmissionDeniedError(decision)
    expect(err.priority).toBe('loop')
    expect(err.capForPriority).toBe(1)
    expect(err.message).toContain('admission denied')
    expect(err.name).toBe('AdmissionDeniedError')
  })

  it('rejects invalid totalCap construction', () => {
    expect(() => createAdmissionController({ totalCap: 0 })).toThrow()
    expect(() => createAdmissionController({ totalCap: -3 })).toThrow()
  })

  it('rejects negative reservedSlots', () => {
    expect(() =>
      createAdmissionController({
        totalCap: 5,
        reservedSlots: { interactive: -1 } as never,
      }),
    ).toThrow()
  })

  it('setTotalCap allows live resize', () => {
    const ctrl = createAdmissionController({
      totalCap: 1,
      reservedSlots: { interactive: 0, 'ship-root': 0, 'ship-verify': 0, 'dag-task': 0, loop: 0 },
    })
    ctrl.tryAdmit('a', 'loop')
    expect(ctrl.tryAdmit('b', 'loop').admitted).toBe(false)
    ctrl.setTotalCap(3)
    expect(ctrl.tryAdmit('b', 'loop').admitted).toBe(true)
  })

  it('PRIORITY_ORDER lists priorities high-to-low', () => {
    expect(PRIORITY_ORDER).toEqual(['interactive', 'ship-root', 'ship-verify', 'dag-task', 'loop'])
  })
})
