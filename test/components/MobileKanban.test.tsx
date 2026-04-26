import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/preact'
import { MobileKanban } from '../../src/components/MobileKanban'
import type { ApiSession } from '../../src/api/types'

const mockSession = (overrides: Partial<ApiSession> = {}): ApiSession => ({
  id: 'sess-1',
  slug: 'test-slug',
  status: 'running',
  command: 'test command',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
  ...overrides,
})

describe('MobileKanban', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders empty state when no sessions', () => {
    render(<MobileKanban sessions={[]} dags={[]} onOpenChat={vi.fn()} />)
    expect(screen.getByTestId('kanban-empty')).toBeTruthy()
    expect(screen.getByText('No sessions yet')).toBeTruthy()
  })

  it('renders all four swimlanes', () => {
    const sessions = [
      mockSession({ id: '1', status: 'pending' }),
      mockSession({ id: '2', status: 'running' }),
      mockSession({ id: '3', status: 'completed' }),
      mockSession({ id: '4', status: 'failed' }),
    ]
    render(<MobileKanban sessions={sessions} dags={[]} onOpenChat={vi.fn()} />)

    expect(screen.getByTestId('kanban-lane-pending')).toBeTruthy()
    expect(screen.getByTestId('kanban-lane-running')).toBeTruthy()
    expect(screen.getByTestId('kanban-lane-completed')).toBeTruthy()
    expect(screen.getByTestId('kanban-lane-failed')).toBeTruthy()
  })

  it('groups sessions by status', () => {
    const sessions = [
      mockSession({ id: '1', slug: 'pending-1', status: 'pending' }),
      mockSession({ id: '2', slug: 'running-1', status: 'running' }),
      mockSession({ id: '3', slug: 'running-2', status: 'running' }),
      mockSession({ id: '4', slug: 'completed-1', status: 'completed' }),
    ]
    render(<MobileKanban sessions={sessions} dags={[]} onOpenChat={vi.fn()} />)

    const pendingLane = screen.getByTestId('kanban-lane-pending')
    const runningLane = screen.getByTestId('kanban-lane-running')
    const completedLane = screen.getByTestId('kanban-lane-completed')
    const failedLane = screen.getByTestId('kanban-lane-failed')

    expect(pendingLane.textContent).toContain('1')
    expect(runningLane.textContent).toContain('2')
    expect(completedLane.textContent).toContain('1')
    expect(failedLane.textContent).toContain('0')
  })

  it('renders session cards with correct data', () => {
    const session = mockSession({
      id: 'sess-1',
      slug: 'test-slug',
      status: 'running',
      command: 'This is a test command',
      branch: 'feature/test',
    })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={vi.fn()} />)

    const card = screen.getByTestId('kanban-card-sess-1')
    expect(card.textContent).toContain('test-slug')
    expect(card.textContent).toContain('This is a test command')
    expect(card.textContent).toContain('feature/test')
  })

  it('calls onOpenChat when card is clicked', () => {
    const onOpenChat = vi.fn()
    const session = mockSession({ id: 'sess-1', status: 'running' })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={onOpenChat} />)

    const card = screen.getByTestId('kanban-card-sess-1')
    fireEvent.click(card)
    expect(onOpenChat).toHaveBeenCalledWith('sess-1')
  })

  it('shows attention indicators for sessions needing attention', () => {
    const session = mockSession({
      id: 'sess-1',
      status: 'failed',
      needsAttention: true,
      attentionReasons: ['failed', 'ci_fix'],
    })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={vi.fn()} />)

    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('ci fix')).toBeTruthy()
  })

  it('shows PR link when session has prUrl', () => {
    const session = mockSession({
      id: 'sess-1',
      status: 'running',
      prUrl: 'https://github.com/org/repo/pull/123',
    })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={vi.fn()} />)

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com/org/repo/pull/123')
  })

  it('sorts sessions by updatedAt (newest first)', () => {
    const sessions = [
      mockSession({ id: '1', slug: 'old', status: 'running', updatedAt: '2024-01-01T00:00:00Z' }),
      mockSession({ id: '2', slug: 'new', status: 'running', updatedAt: '2024-01-03T00:00:00Z' }),
      mockSession({ id: '3', slug: 'mid', status: 'running', updatedAt: '2024-01-02T00:00:00Z' }),
    ]
    render(<MobileKanban sessions={sessions} dags={[]} onOpenChat={vi.fn()} />)

    const cards = screen.getAllByTestId(/^kanban-card-/)
    expect(cards[0].textContent).toContain('new')
    expect(cards[1].textContent).toContain('mid')
    expect(cards[2].textContent).toContain('old')
  })

  it('shows empty message for lanes with no sessions', () => {
    const session = mockSession({ id: '1', status: 'running' })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={vi.fn()} />)

    expect(screen.getByText('No pending sessions')).toBeTruthy()
    expect(screen.getByText('No completed sessions')).toBeTruthy()
    expect(screen.getByText('No failed sessions')).toBeTruthy()
  })

  it('truncates long command previews', () => {
    const longCommand = 'a'.repeat(100)
    const session = mockSession({ id: '1', status: 'running', command: longCommand })
    render(<MobileKanban sessions={[session]} dags={[]} onOpenChat={vi.fn()} />)

    const card = screen.getByTestId('kanban-card-1')
    const commandText = card.textContent || ''
    expect(commandText).not.toContain(longCommand)
    expect(commandText.length).toBeLessThan(longCommand.length)
  })
})
