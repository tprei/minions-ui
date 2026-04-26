import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signal } from '@preact/signals'
import { ChatPanel } from '../../src/chat/ChatPanel'
import type { ApiSession } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 1000,
  })
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const session: ApiSession = {
  id: 's1',
  slug: 'test-session',
  status: 'running',
  command: '/task foo',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
}

const mockTranscript = {
  events: signal([]),
  loading: signal(false),
  error: signal(null),
  session: signal(session),
}

const mockStore = {
  sessions: signal([session]),
  dags: signal([]),
  version: signal({ apiVersion: '2.0.0', libraryVersion: '1.120.0', features: ['transcript', 'messages'] as string[] }),
  getTranscript: vi.fn().mockReturnValue(mockTranscript),
  client: {},
  applySessionCreated: vi.fn(),
  diffStatsBySessionId: signal(new Map()),
} as unknown as ConnectionStore

const mockOnSend = vi.fn().mockResolvedValue(undefined)
const mockOnCommand = vi.fn().mockResolvedValue({ success: true })
const mockOnNavigate = vi.fn()

describe('ChatPanel', () => {
  it('renders in desktop mode on wide screens', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(min-width: 768px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const panel = screen.getByTestId('chat-panel')
    expect(panel.getAttribute('data-mode')).toBe('desktop')
  })

  it('renders in sheet mode on mobile by default', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const panel = screen.getByTestId('chat-panel')
    expect(panel.getAttribute('data-mode')).toBe('sheet')
  })

  it('shows snap point controls in sheet mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    expect(screen.getByTestId('chat-snap-peek')).toBeTruthy()
    expect(screen.getByTestId('chat-snap-half')).toBeTruthy()
    expect(screen.getByTestId('chat-snap-full')).toBeTruthy()
  })

  it('initializes at peek snap point', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const panel = screen.getByTestId('chat-panel')
    expect(panel.getAttribute('data-snap')).toBe('peek')
  })

  it('can snap to half by clicking button', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const halfBtn = screen.getByTestId('chat-snap-half')
    fireEvent.click(halfBtn)

    await waitFor(() => {
      const panel = screen.getByTestId('chat-panel')
      expect(panel.getAttribute('data-snap')).toBe('half')
    })
  })

  it('can snap to full by clicking button', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const fullBtn = screen.getByTestId('chat-snap-full')
    fireEvent.click(fullBtn)

    await waitFor(() => {
      const panel = screen.getByTestId('chat-panel')
      expect(panel.getAttribute('data-snap')).toBe('full')
    })
  })

  it('toggles fullscreen mode on mobile', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const expandBtn = screen.getByTestId('chat-fullscreen-btn')
    expect(expandBtn.textContent).toBe('Expand')

    fireEvent.click(expandBtn)

    await waitFor(() => {
      const panel = screen.getByTestId('chat-panel')
      expect(panel.getAttribute('data-mode')).toBe('fullscreen')
    })

    const collapseBtn = screen.getByTestId('chat-fullscreen-btn')
    expect(collapseBtn.textContent).toBe('Collapse')
  })

  it('persists fullscreen state to localStorage', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const expandBtn = screen.getByTestId('chat-fullscreen-btn')
    fireEvent.click(expandBtn)

    await waitFor(() => {
      expect(localStorage.getItem('minions-ui:chat-fullscreen')).toBe('true')
    })
  })

  it('renders session header with status', () => {
    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    expect(screen.getAllByText('test-session').length).toBeGreaterThan(0)
    expect(screen.getByTestId('chat-pane-status').textContent).toBe('running')
  })

  it('shows stop button when session is running', () => {
    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const stopBtn = screen.getByTestId('chat-stop-btn')
    expect(stopBtn.hasAttribute('disabled')).toBe(false)
  })

  it('disables stop button when session is completed', () => {
    const completedSession = { ...session, status: 'completed' as const }

    render(
      <ChatPanel
        session={completedSession}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const stopBtn = screen.getByTestId('chat-stop-btn')
    expect(stopBtn.hasAttribute('disabled')).toBe(true)
  })

  it('shows parent navigation button when session has parent', () => {
    const childSession = { ...session, id: 's2' }
    const dag = {
      id: 'd1',
      rootTaskId: 's1',
      status: 'running' as const,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      nodes: {
        n1: {
          id: 'n1',
          slug: 'n1',
          parentIds: [],
          dependencies: [],
          dependents: [],
          status: 'running' as const,
          session: childSession,
        },
      },
    }

    const storeWithDag = {
      ...mockStore,
      sessions: signal([session, childSession]),
      dags: signal([dag]),
      diffStatsBySessionId: signal(new Map()),
    }

    render(
      <ChatPanel
        session={childSession}
        store={storeWithDag}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
        onNavigate={mockOnNavigate}
      />
    )

    const parentBtn = screen.getByTestId('chat-pane-parent-btn')
    expect(parentBtn.textContent).toContain('test-session')
  })

  it('calls onNavigate when parent button is clicked', () => {
    const childSession = { ...session, id: 's2' }
    const dag = {
      id: 'd1',
      rootTaskId: 's1',
      status: 'running' as const,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      nodes: {
        n1: {
          id: 'n1',
          slug: 'n1',
          parentIds: [],
          dependencies: [],
          dependents: [],
          status: 'running' as const,
          session: childSession,
        },
      },
    }

    const storeWithDag = {
      ...mockStore,
      sessions: signal([session, childSession]),
      dags: signal([dag]),
      diffStatsBySessionId: signal(new Map()),
    }

    render(
      <ChatPanel
        session={childSession}
        store={storeWithDag}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
        onNavigate={mockOnNavigate}
      />
    )

    const parentBtn = screen.getByTestId('chat-pane-parent-btn')
    fireEvent.click(parentBtn)

    expect(mockOnNavigate).toHaveBeenCalledWith('s1')
  })

  it('shows PR link when session has prUrl', () => {
    const sessionWithPr = { ...session, prUrl: 'https://github.com/org/repo/pull/123' }

    render(
      <ChatPanel
        session={sessionWithPr}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    const prLink = screen.getByText('PR') as HTMLAnchorElement
    expect(prLink.href).toBe('https://github.com/org/repo/pull/123')
  })

  it('renders drag handle in sheet mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    expect(screen.getByTestId('drag-handle')).toBeTruthy()
  })

  it('does not render drag handle in desktop mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(min-width: 768px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    expect(screen.queryByTestId('drag-handle')).toBeFalsy()
  })

  it('does not render snap controls in desktop mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(min-width: 768px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(
      <ChatPanel
        session={session}
        store={mockStore}
        onSend={mockOnSend}
        onCommand={mockOnCommand}
      />
    )

    expect(screen.queryByTestId('chat-snap-peek')).toBeFalsy()
    expect(screen.queryByTestId('chat-snap-half')).toBeFalsy()
    expect(screen.queryByTestId('chat-snap-full')).toBeFalsy()
  })
})
