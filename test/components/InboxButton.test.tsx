import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { InboxButton } from '../../src/components/InboxButton'
import * as connectionsStore from '../../src/connections/store'
import { __resetInboxes, markInboxSeen, recordInboxEvent } from '../../src/state/inbox'
import type { Connection } from '../../src/connections/types'

vi.mock('../../src/connections/store', () => ({
  connections: signal<Connection[]>([]),
  activeId: signal<string | null>(null),
}))

function makeConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    label: 'Test',
    baseUrl: 'http://localhost:8080',
    token: 'tok',
    color: '#3b82f6',
    ...overrides,
  }
}

describe('InboxButton', () => {
  let connections: ReturnType<typeof signal<Connection[]>>
  let activeId: ReturnType<typeof signal<string | null>>

  beforeEach(() => {
    __resetInboxes()
    connections = signal<Connection[]>([])
    activeId = signal<string | null>(null)
    ;(vi.mocked(connectionsStore).connections as typeof connections) = connections
    ;(vi.mocked(connectionsStore).activeId as typeof activeId) = activeId
  })

  it('renders an empty button when there are no events', () => {
    connections.value = [makeConn()]
    activeId.value = 'c1'
    render(<InboxButton />)
    const btn = screen.getByTestId('header-inbox-btn')
    expect(btn).toBeTruthy()
    expect(screen.queryByTestId('inbox-total-unseen-badge')).toBeFalsy()
  })

  it('shows the total unseen count badge across connections', () => {
    connections.value = [makeConn({ id: 'c1' }), makeConn({ id: 'c2' })]
    activeId.value = 'c1'

    markInboxSeen('c1')
    markInboxSeen('c2')

    const seenAt = Date.now()
    recordInboxEvent('c1', {
      id: 'a',
      sessionId: 's1',
      sessionSlug: 's1',
      label: 's1',
      kind: 'completed',
      ts: seenAt + 1000,
    })
    recordInboxEvent('c2', {
      id: 'b',
      sessionId: 's2',
      sessionSlug: 's2',
      label: 's2',
      kind: 'failed',
      ts: seenAt + 2000,
    })

    render(<InboxButton />)
    const badge = screen.getByTestId('inbox-total-unseen-badge')
    expect(badge.textContent).toBe('2')
  })

  it('opens the inbox panel when clicked', () => {
    connections.value = [makeConn()]
    activeId.value = 'c1'
    recordInboxEvent('c1', {
      id: 'a',
      sessionId: 's1',
      sessionSlug: 'first',
      label: 'first',
      kind: 'completed',
      ts: Date.now(),
    })
    render(<InboxButton />)
    fireEvent.click(screen.getByTestId('header-inbox-btn'))
    expect(screen.getByTestId('inbox-panel')).toBeTruthy()
  })

  it('disables the button when no active connection', () => {
    connections.value = []
    activeId.value = null
    render(<InboxButton />)
    const btn = screen.getByTestId('header-inbox-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('calls onSelectEvent when an event is clicked', () => {
    connections.value = [makeConn()]
    activeId.value = 'c1'
    recordInboxEvent('c1', {
      id: 'a',
      sessionId: 's1',
      sessionSlug: 'first',
      label: 'first',
      kind: 'completed',
      ts: Date.now(),
    })
    const onSelect = vi.fn()
    render(<InboxButton onSelectEvent={onSelect} />)
    fireEvent.click(screen.getByTestId('header-inbox-btn'))
    fireEvent.click(screen.getByTestId('inbox-item-a'))
    expect(onSelect).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'a' }))
  })
})
