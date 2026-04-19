import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi } from 'vitest'
import { SessionTabs } from '../../src/chat/SessionTabs'

describe('SessionTabs', () => {
  it('renders only available tabs', () => {
    render(
      <SessionTabs
        tabs={[
          { id: 'chat', label: 'Chat', available: true },
          { id: 'diff', label: 'Diff', available: false },
          { id: 'screenshots', label: 'Screenshots', available: true },
        ]}
        active="chat"
        onChange={vi.fn()}
      >
        <div>body</div>
      </SessionTabs>
    )
    expect(screen.getByTestId('session-tab-chat')).toBeTruthy()
    expect(screen.queryByTestId('session-tab-diff')).toBeNull()
    expect(screen.getByTestId('session-tab-screenshots')).toBeTruthy()
  })

  it('marks the active tab with aria-selected', () => {
    render(
      <SessionTabs
        tabs={[
          { id: 'chat', label: 'Chat', available: true },
          { id: 'diff', label: 'Diff', available: true },
        ]}
        active="diff"
        onChange={vi.fn()}
      >
        <div>body</div>
      </SessionTabs>
    )
    expect(screen.getByTestId('session-tab-diff').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('session-tab-chat').getAttribute('aria-selected')).toBe('false')
  })

  it('fires onChange when an inactive tab is clicked', () => {
    const onChange = vi.fn()
    render(
      <SessionTabs
        tabs={[
          { id: 'chat', label: 'Chat', available: true },
          { id: 'diff', label: 'Diff', available: true },
        ]}
        active="chat"
        onChange={onChange}
      >
        <div>body</div>
      </SessionTabs>
    )
    fireEvent.click(screen.getByTestId('session-tab-diff'))
    expect(onChange).toHaveBeenCalledWith('diff')
  })

  it('renders children inside the tabpanel region', () => {
    render(
      <SessionTabs
        tabs={[{ id: 'chat', label: 'Chat', available: true }]}
        active="chat"
        onChange={vi.fn()}
      >
        <div data-testid="tab-body">hello</div>
      </SessionTabs>
    )
    expect(screen.getByTestId('tab-body').textContent).toBe('hello')
  })
})
