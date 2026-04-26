import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { ActivityFeed } from '../../src/activity/ActivityFeed'
import { trackEvent, clearEvents } from '../../src/activity/store'
import { connections } from '../../src/connections/store'
import type { Connection } from '../../src/connections/types'
import type { ApiSession, SseEvent } from '../../src/api/types'

describe('ActivityFeed', () => {
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
    connections.value = [mockConnection]
  })

  it('renders empty state when no events', () => {
    render(<ActivityFeed />)
    expect(screen.getByText('No activity yet')).toBeDefined()
    expect(screen.getByText('Events from all connections will appear here')).toBeDefined()
  })

  it('renders events in timeline', () => {
    const event: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, event)

    render(<ActivityFeed />)

    expect(screen.getByText(/Session test-session created/)).toBeDefined()
    expect(screen.getByText('Test Connection')).toBeDefined()
  })

  it('shows event count in header', () => {
    const event1: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    const event2: SseEvent = {
      type: 'session_created',
      session: { ...mockSession, id: 'session-2', slug: 'session-2' },
    }
    trackEvent('conn-1', mockConnection, event1)
    trackEvent('conn-1', mockConnection, event2)

    render(<ActivityFeed />)

    expect(screen.getByText('2 events')).toBeDefined()
  })

  it('renders search input', () => {
    render(<ActivityFeed />)
    const searchInput = screen.getByPlaceholderText('Search events...')
    expect(searchInput).toBeDefined()
  })

  it('renders filter button', () => {
    render(<ActivityFeed />)
    const filterBtn = screen.getByTestId('activity-filter-btn')
    expect(filterBtn).toBeDefined()
  })

  it('renders clear button', () => {
    render(<ActivityFeed />)
    const clearBtn = screen.getByTestId('activity-clear-btn')
    expect(clearBtn).toBeDefined()
  })

  it('renders session links in events', () => {
    const event: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, event)

    render(<ActivityFeed />)

    const link = screen.getByText('test-session')
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('#/s/test-session')
  })

  it('renders status changes with old and new status', () => {
    const created: SseEvent = {
      type: 'session_created',
      session: mockSession,
    }
    trackEvent('conn-1', mockConnection, created)

    const updated: SseEvent = {
      type: 'session_updated',
      session: { ...mockSession, status: 'running' },
    }
    trackEvent('conn-1', mockConnection, updated)

    render(<ActivityFeed />)

    expect(screen.getByText('pending')).toBeDefined()
    expect(screen.getByText('running')).toBeDefined()
  })
})
