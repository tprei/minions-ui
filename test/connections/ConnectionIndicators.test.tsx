import { render, screen } from '@testing-library/preact'
import { describe, it, expect } from 'vitest'
import { ConnectionIndicators } from '../../src/connections/ConnectionIndicators'

describe('ConnectionIndicators', () => {
  it('renders nothing when no stats', () => {
    const { container } = render(<ConnectionIndicators />)
    expect(container.textContent).toBe('')
  })

  it('renders unread badge', () => {
    render(<ConnectionIndicators unreadCount={3} compact />)
    const badge = screen.getByTestId('connection-unread-badge')
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('3')
  })

  it('renders activity dot in compact mode', () => {
    render(
      <ConnectionIndicators
        activityCounts={{ running: 2, pending: 1, waiting: 0 }}
        compact
      />
    )
    expect(screen.getByTestId('connection-activity-dot')).toBeTruthy()
  })

  it('renders detailed activity badges when not compact', () => {
    render(
      <ConnectionIndicators
        activityCounts={{ running: 2, pending: 1, waiting: 1 }}
      />
    )
    const badges = screen.getByTestId('connection-activity-badges')
    expect(badges).toBeTruthy()
    expect(badges.textContent).toContain('2')
    expect(badges.textContent).toContain('1')
  })

  it('renders only running count when others are zero', () => {
    render(
      <ConnectionIndicators
        activityCounts={{ running: 3, pending: 0, waiting: 0 }}
      />
    )
    const badges = screen.getByTestId('connection-activity-badges')
    expect(badges.textContent).toContain('3')
    expect(badges.children.length).toBe(1)
  })

  it('renders both unread and activity in compact mode', () => {
    render(
      <ConnectionIndicators
        unreadCount={2}
        activityCounts={{ running: 1, pending: 0, waiting: 0 }}
        compact
      />
    )
    expect(screen.getByTestId('connection-unread-badge')).toBeTruthy()
    expect(screen.getByTestId('connection-activity-dot')).toBeTruthy()
  })
})
