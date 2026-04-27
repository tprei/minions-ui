import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { InboxPanel, InboxList, InboxSheet } from '../../src/components/InboxPanel'
import {
  __resetInboxes,
  markInboxSeen,
  recordInboxEvent,
} from '../../src/state/inbox'

describe('InboxPanel', () => {
  beforeEach(() => {
    __resetInboxes()
  })

  it('shows empty state when there are no events', () => {
    render(<InboxPanel connectionId="c1" onClose={() => {}} />)
    expect(screen.getByTestId('inbox-empty')).toBeTruthy()
  })

  it('renders events newest-first', () => {
    recordInboxEvent('c1', {
      id: 'a',
      sessionId: 's1',
      sessionSlug: 'first',
      label: 'first',
      kind: 'completed',
      ts: 1000,
    })
    recordInboxEvent('c1', {
      id: 'b',
      sessionId: 's2',
      sessionSlug: 'second',
      label: 'second',
      kind: 'failed',
      ts: 2000,
    })

    render(<InboxList connectionId="c1" />)
    expect(screen.getByTestId('inbox-item-a')).toBeTruthy()
    expect(screen.getByTestId('inbox-item-b')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].getAttribute('data-testid')).toBe('inbox-item-b')
    expect(buttons[1].getAttribute('data-testid')).toBe('inbox-item-a')
  })

  it('marks events as unseen when ts > lastSeenAt', () => {
    markInboxSeen('c1')
    const seenAt = Date.now()
    recordInboxEvent('c1', {
      id: 'old',
      sessionId: 's1',
      sessionSlug: 'old',
      label: 'old',
      kind: 'completed',
      ts: seenAt - 5000,
    })
    recordInboxEvent('c1', {
      id: 'new',
      sessionId: 's2',
      sessionSlug: 'new',
      label: 'new',
      kind: 'completed',
      ts: seenAt + 5000,
    })

    render(<InboxList connectionId="c1" />)
    const newItem = screen.getByTestId('inbox-item-new')
    const oldItem = screen.getByTestId('inbox-item-old')
    expect(newItem.getAttribute('data-unseen')).toBe('true')
    expect(oldItem.getAttribute('data-unseen')).toBe('false')
  })

  it('calls onSelect with the event when an item is clicked', () => {
    recordInboxEvent('c1', {
      id: 'a',
      sessionId: 's1',
      sessionSlug: 'first',
      label: 'first',
      kind: 'completed',
      ts: 1000,
    })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<InboxPanel connectionId="c1" onClose={onClose} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('inbox-item-a'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', sessionId: 's1' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn()
    render(<InboxPanel connectionId="c1" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('inbox-panel-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<InboxPanel connectionId="c1" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('InboxSheet', () => {
  beforeEach(() => {
    __resetInboxes()
  })

  it('renders the sheet variant with backdrop', () => {
    render(<InboxSheet connectionId="c1" onClose={() => {}} />)
    expect(screen.getByTestId('inbox-sheet')).toBeTruthy()
    expect(screen.getByTestId('inbox-sheet-backdrop')).toBeTruthy()
  })

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<InboxSheet connectionId="c1" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('inbox-sheet-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(<InboxSheet connectionId="c1" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
