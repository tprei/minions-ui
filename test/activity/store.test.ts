import { describe, it, expect, beforeEach } from 'vitest'
import { trackEvent, clearEvents, activityEvents, filteredEvents, setFilters, clearFilters } from '../../src/activity/store'
import type { Connection } from '../../src/connections/types'
import type { ApiSession, SseEvent } from '../../src/api/types'

describe('activity store', () => {
  const mockConnection: Connection = {
    id: 'conn-1',
    label: 'Test Connection',
    baseUrl: 'http://localhost:8080',
    token: 'test-token',
    color: '#3b82f6',
  }

  const mockSession: ApiSession = {
    id: 'session-1',
    slug: 'test-session',
    status: 'pending',
    command: 'test command',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
  }

  beforeEach(() => {
    clearEvents()
    clearFilters()
  })

  it('tracks session_created events', () => {
    const event: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }

    trackEvent('conn-1', mockConnection, event)

    expect(activityEvents.value).toHaveLength(1)
    expect(activityEvents.value[0]).toMatchObject({
      connectionId: 'conn-1',
      connectionLabel: 'Test Connection',
      type: 'session_created',
      sessionId: 'session-1',
      sessionSlug: 'test-session',
    })
  })

  it('tracks session status changes', () => {
    const createdEvent: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, createdEvent)

    const updatedEvent: SseEvent = {
      type: 'session_updated',
      session: { ...mockSession, status: 'running' },
    }
    trackEvent('conn-1', mockConnection, updatedEvent)

    expect(activityEvents.value).toHaveLength(2)
    expect(activityEvents.value[0]).toMatchObject({
      type: 'session_status_changed',
      oldStatus: 'pending',
      status: 'running',
    })
  })

  it('tracks attention raised events', () => {
    const event: SseEvent = {
      type: 'session_updated',
      session: {
        ...mockSession,
        needsAttention: true,
        attentionReasons: ['waiting_for_feedback'],
      },
    }

    trackEvent('conn-1', mockConnection, event)

    expect(activityEvents.value).toHaveLength(1)
    expect(activityEvents.value[0]).toMatchObject({
      type: 'attention_raised',
      message: expect.stringContaining('waiting_for_feedback'),
    })
  })

  it('limits events to MAX_EVENTS', () => {
    for (let i = 0; i < 600; i++) {
      const event: SseEvent = {
        type: 'session_created',
        session: { ...mockSession, id: `session-${i}`, slug: `session-${i}` },
      }
      trackEvent('conn-1', mockConnection, event)
    }

    expect(activityEvents.value).toHaveLength(500)
  })

  it('filters events by connection', () => {
    const event1: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, event1)

    const event2: SseEvent = {
      type: 'session_created',
      session: { ...mockSession, id: 'session-2', slug: 'session-2' },
    }
    trackEvent('conn-2', { ...mockConnection, id: 'conn-2', label: 'Other Connection' }, event2)

    setFilters({ connectionIds: new Set(['conn-1']) })

    expect(filteredEvents.value).toHaveLength(1)
    expect(filteredEvents.value[0].connectionId).toBe('conn-1')
  })

  it('filters events by type', () => {
    const event1: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, event1)

    const event2: SseEvent = {
      type: 'session_deleted',
      sessionId: 'session-1',
    }
    trackEvent('conn-1', mockConnection, event2)

    setFilters({ types: new Set(['session_created']) })

    expect(filteredEvents.value).toHaveLength(1)
    expect(filteredEvents.value[0].type).toBe('session_created')
  })

  it('filters events by search query', () => {
    const event1: SseEvent = {
      type: 'session_created',
      session: { ...mockSession, slug: 'important-task' },
    }
    trackEvent('conn-1', mockConnection, event1)

    const event2: SseEvent = {
      type: 'session_created',
      session: { ...mockSession, id: 'session-2', slug: 'other-task' },
    }
    trackEvent('conn-1', mockConnection, event2)

    setFilters({ searchQuery: 'important' })

    expect(filteredEvents.value).toHaveLength(1)
    expect(filteredEvents.value[0].sessionSlug).toBe('important-task')
  })

  it('clears all events', () => {
    const event: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, event)

    expect(activityEvents.value).toHaveLength(1)

    clearEvents()

    expect(activityEvents.value).toHaveLength(0)
  })

  it('clears filters', () => {
    setFilters({
      connectionIds: new Set(['conn-1']),
      types: new Set(['session_created']),
      searchQuery: 'test',
    })

    clearFilters()

    expect(activityEvents.value).toHaveLength(0)
  })
})
