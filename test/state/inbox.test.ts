import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetInboxes,
  clearInbox,
  getInboxEvents,
  getUnseenCount,
  inboxSignal,
  markInboxSeen,
  recordInboxEvent,
  type InboxEvent,
} from '../../src/state/inbox'

function makeEvent(overrides: Partial<InboxEvent> = {}): InboxEvent {
  return {
    id: overrides.id ?? `e-${Math.random()}`,
    sessionId: 's1',
    sessionSlug: 'cool-cat',
    label: '/task hello',
    kind: 'completed',
    ts: Date.now(),
    ...overrides,
  }
}

describe('inbox state', () => {
  beforeEach(() => {
    __resetInboxes()
  })

  it('records events in newest-first order', () => {
    recordInboxEvent('c1', makeEvent({ id: 'a', ts: 100 }))
    recordInboxEvent('c1', makeEvent({ id: 'b', ts: 200 }))
    recordInboxEvent('c1', makeEvent({ id: 'c', ts: 300 }))

    const events = getInboxEvents('c1')
    expect(events.map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('caps stored events at 50', () => {
    for (let i = 0; i < 60; i++) {
      recordInboxEvent('c1', makeEvent({ id: `e-${i}`, ts: i }))
    }
    expect(getInboxEvents('c1')).toHaveLength(50)
  })

  it('dedupes events by id (latest wins)', () => {
    recordInboxEvent('c1', makeEvent({ id: 'dup', ts: 100, kind: 'attention' }))
    recordInboxEvent('c1', makeEvent({ id: 'dup', ts: 200, kind: 'completed' }))

    const events = getInboxEvents('c1')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('completed')
    expect(events[0].ts).toBe(200)
  })

  it('reports unseen count for events newer than lastSeenAt', () => {
    markInboxSeen('c1')
    const seenAt = inboxSignal('c1').value.lastSeenAt
    recordInboxEvent('c1', makeEvent({ id: 'a', ts: seenAt - 1000 }))
    recordInboxEvent('c1', makeEvent({ id: 'b', ts: seenAt + 1000 }))
    recordInboxEvent('c1', makeEvent({ id: 'c', ts: seenAt + 2000 }))

    expect(getUnseenCount('c1')).toBe(2)
  })

  it('marks all events seen when markInboxSeen is called', () => {
    recordInboxEvent('c1', makeEvent({ id: 'a', ts: Date.now() - 1000 }))
    recordInboxEvent('c1', makeEvent({ id: 'b', ts: Date.now() }))
    expect(getUnseenCount('c1')).toBeGreaterThan(0)

    markInboxSeen('c1')
    expect(getUnseenCount('c1')).toBe(0)
  })

  it('persists lastSeenAt across module reloads via localStorage', async () => {
    markInboxSeen('c1')
    const seenAt = inboxSignal('c1').value.lastSeenAt

    __resetInboxes()
    localStorage.setItem(
      'minions-ui:inbox:v1',
      JSON.stringify({ version: 1, perConnection: { c1: { lastSeenAt: seenAt } } }),
    )

    recordInboxEvent('c1', makeEvent({ id: 'old', ts: seenAt - 1000 }))
    recordInboxEvent('c1', makeEvent({ id: 'new', ts: seenAt + 1000 }))
    expect(getUnseenCount('c1')).toBe(1)
  })

  it('isolates events between connections', () => {
    recordInboxEvent('c1', makeEvent({ id: 'a' }))
    recordInboxEvent('c2', makeEvent({ id: 'b' }))
    recordInboxEvent('c2', makeEvent({ id: 'c' }))

    expect(getInboxEvents('c1').map((e) => e.id)).toEqual(['a'])
    expect(getInboxEvents('c2').map((e) => e.id)).toEqual(['c', 'b'])
  })

  it('clearInbox removes both events and persisted lastSeenAt', () => {
    recordInboxEvent('c1', makeEvent({ id: 'a' }))
    markInboxSeen('c1')
    expect(getInboxEvents('c1')).toHaveLength(1)

    clearInbox('c1')
    expect(getInboxEvents('c1')).toHaveLength(0)
    expect(inboxSignal('c1').value.lastSeenAt).toBe(0)
  })

  it('inboxSignal updates reactively', () => {
    const sig = inboxSignal('c1')
    expect(sig.value.events).toHaveLength(0)

    recordInboxEvent('c1', makeEvent({ id: 'a' }))
    expect(sig.value.events).toHaveLength(1)
  })
})
