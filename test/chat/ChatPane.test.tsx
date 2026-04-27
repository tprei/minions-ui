import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import { ChatPane } from '../../src/chat/ChatPane'
import type { ApiSession } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(true),
}))

vi.mock('../../src/hooks/useConfirm', () => ({
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../src/api/features', () => ({
  hasFeature: () => true,
}))

vi.mock('../../src/chat/SessionTabs', () => ({
  SessionTabs: ({ children }: { children: import('preact').ComponentChildren }) => <div data-testid="session-tabs">{children}</div>,
}))

vi.mock('../../src/chat/DagStatusPanel', () => ({
  DagStatusPanel: () => <div data-testid="dag-status-panel" />,
}))

vi.mock('../../src/components/WorktreeHeader', () => ({
  WorktreeHeader: () => <div data-testid="worktree-header" />,
}))

vi.mock('../../src/chat/transcript', () => ({
  Transcript: () => <div data-testid="transcript" />,
  TranscriptUpgradeNotice: () => <div data-testid="transcript-upgrade-notice" />,
}))

vi.mock('../../src/chat/QuickActionsBar', () => ({
  QuickActionsBar: () => <div data-testid="quick-actions-bar" />,
}))

vi.mock('../../src/chat/SlashCommandMenu', () => ({
  SlashCommandMenu: () => <div data-testid="slash-command-menu" />,
}))

vi.mock('../../src/chat/MessageInput', () => ({
  MessageInput: () => <div data-testid="message-input" />,
}))

describe('ChatPane', () => {
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
    version: signal({ apiVersion: '1.0.0', libraryVersion: '1.110.0', features: ['transcript'] }),
    getTranscript: vi.fn(() => ({
      turns: signal([]),
      sessionId: 'test-session-1',
    })),
  } as unknown as ConnectionStore

  const mockOnSend = vi.fn()
  const mockOnCommand = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chat pane with session info', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('chat-pane')).toBeTruthy()
    expect(screen.getByText('test-session')).toBeTruthy()
  })

  it('displays session status', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('chat-pane-status').textContent).toBe('running')
  })

  it('renders stop button when session is running', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const stopBtn = screen.getByTestId('chat-stop-btn')
    expect(stopBtn).toBeTruthy()
    expect(stopBtn.hasAttribute('disabled')).toBe(false)
  })

  it('renders close button', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('chat-close-btn')).toBeTruthy()
  })

  it('calls onCommand with stop action when stop is clicked', async () => {
    mockOnCommand.mockResolvedValue({ success: true })

    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const stopBtn = screen.getByTestId('chat-stop-btn')
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(mockOnCommand).toHaveBeenCalledWith({
        action: 'stop',
        sessionId: 'test-session-1',
      })
    })
  })

  it('calls onCommand with close action when close is clicked', async () => {
    mockOnCommand.mockResolvedValue({ success: true })

    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const closeBtn = screen.getByTestId('chat-close-btn')
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(mockOnCommand).toHaveBeenCalledWith({
        action: 'close',
        sessionId: 'test-session-1',
      })
    })
  })

  it('renders transcript when available', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('transcript')).toBeTruthy()
  })

  it('renders worktree header', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('worktree-header')).toBeTruthy()
  })

  it('renders dag status panel', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('dag-status-panel')).toBeTruthy()
  })

  it('renders quick actions bar', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('quick-actions-bar')).toBeTruthy()
  })

  it('renders message input', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    expect(screen.getByTestId('message-input')).toBeTruthy()
  })

  it('disables stop button when session is not running', () => {
    const completedSession = { ...mockSession, status: 'completed' as const }

    render(
      <ChatPane
        session={completedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const stopBtn = screen.getByTestId('chat-stop-btn')
    expect(stopBtn.hasAttribute('disabled')).toBe(true)
  })

  it('does not render the failure-recovery strip when session is running', () => {
    render(
      <ChatPane
        session={mockSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )
    expect(screen.queryByTestId('failure-recovery-strip')).toBeNull()
  })

  it('renders the failure-recovery strip when session is failed', () => {
    const failedSession = { ...mockSession, status: 'failed' as const }
    render(
      <ChatPane
        session={failedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )
    expect(screen.getByTestId('failure-recovery-strip')).toBeTruthy()
    expect(screen.getByTestId('failure-retry-btn')).toBeTruthy()
    expect(screen.getByTestId('failure-resume-btn')).toBeTruthy()
    expect(screen.getByTestId('failure-abort-btn')).toBeTruthy()
  })

  it('clicking failure retry calls onSend with /retry', async () => {
    mockOnSend.mockResolvedValue(undefined)
    const failedSession = { ...mockSession, status: 'failed' as const }
    render(
      <ChatPane
        session={failedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )
    fireEvent.click(screen.getByTestId('failure-retry-btn'))
    await waitFor(() => {
      expect(mockOnSend).toHaveBeenCalledWith('/retry', failedSession.id)
    })
  })

  it('clicking failure resume calls onSend with /resume', async () => {
    mockOnSend.mockResolvedValue(undefined)
    const failedSession = { ...mockSession, status: 'failed' as const }
    render(
      <ChatPane
        session={failedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )
    fireEvent.click(screen.getByTestId('failure-resume-btn'))
    await waitFor(() => {
      expect(mockOnSend).toHaveBeenCalledWith('/resume', failedSession.id)
    })
  })

  it('clicking failure abort calls onCommand with close after confirm', async () => {
    mockOnCommand.mockResolvedValue({ success: true })
    const failedSession = { ...mockSession, status: 'failed' as const }
    render(
      <ChatPane
        session={failedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )
    fireEvent.click(screen.getByTestId('failure-abort-btn'))
    await waitFor(() => {
      expect(mockOnCommand).toHaveBeenCalledWith({
        action: 'close',
        sessionId: failedSession.id,
      })
    })
  })

  it('shows PR link when prUrl is present', () => {
    const sessionWithPr = { ...mockSession, prUrl: 'https://github.com/owner/repo/pull/123' }

    render(
      <ChatPane
        session={sessionWithPr}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />,
    )

    const prLink = screen.getByText('PR')
    expect(prLink).toBeTruthy()
    expect(prLink.closest('a')?.getAttribute('href')).toBe('https://github.com/owner/repo/pull/123')
  })
})
