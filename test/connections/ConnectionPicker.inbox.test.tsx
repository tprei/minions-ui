import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { ConnectionPicker } from '../../src/connections/ConnectionPicker'
import * as store from '../../src/connections/store'
import {
  __resetInboxes,
  markInboxSeen,
  recordInboxEvent,
} from '../../src/state/inbox'
import type { Connection } from '../../src/connections/types'

vi.mock('../../src/connections/store', () => ({
  connections: signal<Connection[]>([]),
  activeId: signal<string | null>(null),
  setActive: vi.fn(),
  getAllStores: vi.fn(() => new Map()),
}))

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(true),
}))

vi.mock('../../src/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({ current: null }),
}))

vi.mock('../../src/hooks/useHaptics', () => ({
  useHaptics: () => ({ vibrate: vi.fn() }),
}))

function makeConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    label: 'Test Connection',
    baseUrl: 'http://localhost:8080',
    token: 'tok',
    color: '#3b82f6',
    ...overrides,
  }
}

describe('ConnectionPicker inbox badges', () => {
  let connectionsSignal: ReturnType<typeof signal<Connection[]>>
  let activeIdSignal: ReturnType<typeof signal<string | null>>

  beforeEach(() => {
    __resetInboxes()
    connectionsSignal = signal<Connection[]>([])
    activeIdSignal = signal<string | null>(null)
    ;(vi.mocked(store).connections as typeof connectionsSignal) = connectionsSignal
    ;(vi.mocked(store).activeId as typeof activeIdSignal) = activeIdSignal
  })

  it('shows inbox count badge when connection has unseen events', () => {
    const conn = makeConn()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    markInboxSeen(conn.id)
    const seenAt = Date.now()
    recordInboxEvent(conn.id, {
      id: 'e1',
      sessionId: 's1',
      sessionSlug: 'foo',
      label: 'foo',
      kind: 'completed',
      ts: seenAt + 1000,
    })
    recordInboxEvent(conn.id, {
      id: 'e2',
      sessionId: 's2',
      sessionSlug: 'bar',
      label: 'bar',
      kind: 'failed',
      ts: seenAt + 2000,
    })

    render(<ConnectionPicker onManage={vi.fn()} />)
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const badge = screen.getByTestId(`picker-inbox-count-${conn.id}`)
    expect(badge.textContent).toBe('+2')
  })

  it('hides inbox count badge when there are no unseen events', () => {
    const conn = makeConn()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    render(<ConnectionPicker onManage={vi.fn()} />)
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    expect(screen.queryByTestId(`picker-inbox-count-${conn.id}`)).toBeFalsy()
  })

  it('hides badge after markInboxSeen is called', () => {
    const conn = makeConn()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    recordInboxEvent(conn.id, {
      id: 'e1',
      sessionId: 's1',
      sessionSlug: 'foo',
      label: 'foo',
      kind: 'completed',
      ts: Date.now(),
    })

    const { rerender } = render(<ConnectionPicker onManage={vi.fn()} />)
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))
    expect(screen.getByTestId(`picker-inbox-count-${conn.id}`)).toBeTruthy()

    markInboxSeen(conn.id)
    rerender(<ConnectionPicker onManage={vi.fn()} />)
    expect(screen.queryByTestId(`picker-inbox-count-${conn.id}`)).toBeFalsy()
  })
})
