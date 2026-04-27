import { render, screen } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import { ChatPanel } from '../../src/chat/ChatPanel'
import type { ApiSession } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(false),
}))

vi.mock('../../src/chat/ChatPane', () => ({
  ChatPane: ({ session }: { session: ApiSession }) => (
    <div data-testid="chat-pane-mock">{session.slug}</div>
  ),
}))

describe('ChatPanel', () => {
  const mockSession: ApiSession = {
    id: 'test-session-1',
    slug: 'test-session',
    status: 'running',
    mode: 'code',
    command: '/task test',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    conversation: [],
  }

  const mockStore = {
    sessions: signal([mockSession]),
    dags: signal([]),
    status: signal('live'),
    error: signal(null),
    stale: signal(false),
    reconnectAt: signal(null),
    version: signal({ apiVersion: '1.0.0', libraryVersion: '1.110.0', features: [] }),
  } as unknown as ConnectionStore

  const mockOnSend = vi.fn()
  const mockOnCommand = vi.fn()
  const mockOnNavigate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders bottom sheet with handle on mobile', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
        onNavigate={mockOnNavigate}
      />,
    )

    expect(screen.getByTestId('chat-panel-sheet')).toBeTruthy()
    expect(screen.getByTestId('chat-panel-handle')).toBeTruthy()
  })

  it('shows snap indicator', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('chat-panel-snap-indicator')).toBeTruthy()
  })

  it('renders ChatPane inside panel', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('chat-pane-mock')).toBeTruthy()
    expect(screen.getByText('test-session')).toBeTruthy()
  })

  it('passes props to ChatPane correctly', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
        onNavigate={mockOnNavigate}
      />,
    )

    expect(screen.getByTestId('chat-pane-mock')).toBeTruthy()
  })

  it('has correct z-index for layering', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const sheet = screen.getByTestId('chat-panel-sheet')
    expect(sheet.className).toContain('z-30')
  })

  it('has rounded top corners', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const sheet = screen.getByTestId('chat-panel-sheet')
    expect(sheet.className).toContain('rounded-t-2xl')
  })

  it('has drag handle styling', () => {
    render(
      <ChatPanel
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const handle = screen.getByTestId('chat-panel-handle')
    expect(handle.className).toContain('cursor-grab')
  })
})
