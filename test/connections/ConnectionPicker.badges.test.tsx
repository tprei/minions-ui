import { render, screen, fireEvent, within } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/connections/store', async () => {
  const { signal } = await import('@preact/signals')
  const connections = signal([
    { id: 'c1', label: 'Alpha', baseUrl: 'https://a.example.com', token: 'ta', color: '#3b82f6' },
    { id: 'c2', label: 'Beta', baseUrl: 'https://b.example.com', token: 'tb', color: '#10b981' },
  ])
  const activeId = signal<string | null>('c1')
  const setActive = vi.fn((id: string | null) => {
    activeId.value = id
  })
  return { connections, activeId, setActive }
})

describe('ConnectionPicker badges', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders sessions count pill on the trigger for the active connection', async () => {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    render(<ConnectionPicker onManage={vi.fn()} activeCounts={{ sessions: 7, attention: 0 }} />)
    const trigger = screen.getByTestId('connection-picker-trigger')
    expect(within(trigger).getByTestId('connection-badge-sessions').textContent).toBe('7')
    expect(within(trigger).queryByTestId('connection-badge-attention')).toBeNull()
  })

  it('renders an attention badge when attention > 0', async () => {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    render(<ConnectionPicker onManage={vi.fn()} activeCounts={{ sessions: 3, attention: 2 }} />)
    const trigger = screen.getByTestId('connection-picker-trigger')
    expect(within(trigger).getByTestId('connection-badge-attention').textContent).toContain('2')
  })

  it('does not render badges when activeCounts is not provided', async () => {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    render(<ConnectionPicker onManage={vi.fn()} />)
    expect(screen.queryByTestId('connection-badges')).toBeNull()
  })

  it('shows badges only next to the active option in the dropdown list', async () => {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    render(<ConnectionPicker onManage={vi.fn()} activeCounts={{ sessions: 4, attention: 1 }} />)
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const activeOption = screen.getByTestId('picker-option-c1')
    const otherOption = screen.getByTestId('picker-option-c2')
    expect(within(activeOption).getByTestId('connection-badge-sessions').textContent).toBe('4')
    expect(within(otherOption).queryByTestId('connection-badge-sessions')).toBeNull()
  })
})
