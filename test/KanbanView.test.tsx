import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { KanbanView } from '../src/components/KanbanView'
import type { ApiSession, ApiDagGraph } from '../src/api/types'
import { connections, activeId } from '../src/connections/store'

vi.mock('../src/hooks/useHaptics', () => ({
  useHaptics: () => ({ vibrate: vi.fn() }),
}))

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: () => ({ value: 'light' }),
}))

const mockSession = (overrides: Partial<ApiSession> = {}): ApiSession => ({
  id: 'test-id',
  slug: 'test-slug',
  status: 'pending',
  command: '/task do something',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
  ...overrides,
})

describe('KanbanView', () => {
  const mockOnSessionSelect = vi.fn()
  const mockDags: ApiDagGraph[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    connections.value = [
      { id: 'conn-1', label: 'Test Connection', baseUrl: 'http://test', token: 'token', color: '#ff0000' },
    ]
    activeId.value = 'conn-1'
  })

  it('renders three columns: Running, Waiting, Done', () => {
    const sessions: ApiSession[] = []
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('categorizes running sessions correctly', () => {
    const sessions = [
      mockSession({ id: 's1', slug: 'running-1', status: 'running' }),
      mockSession({ id: 's2', slug: 'running-2', status: 'running' }),
    ]
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const runningCards = screen.getAllByTestId(/^kanban-card-s[12]$/)
    expect(runningCards).toHaveLength(2)
  })

  it('categorizes pending sessions as waiting', () => {
    const sessions = [
      mockSession({ id: 's1', slug: 'pending-1', status: 'pending' }),
      mockSession({ id: 's2', slug: 'pending-2', status: 'pending', needsAttention: true, attentionReasons: ['waiting_for_feedback'] }),
    ]
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    expect(screen.getByText('pending-1')).toBeTruthy()
    expect(screen.getByText('pending-2')).toBeTruthy()
  })

  it('categorizes completed and failed sessions as done', () => {
    const sessions = [
      mockSession({ id: 's1', slug: 'completed-1', status: 'completed' }),
      mockSession({ id: 's2', slug: 'failed-1', status: 'failed' }),
    ]
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    expect(screen.getByText('completed-1')).toBeTruthy()
    expect(screen.getByText('failed-1')).toBeTruthy()
  })

  it('calls onSessionSelect when card is clicked', () => {
    const session = mockSession({ id: 's1', slug: 'test-session' })
    render(<KanbanView sessions={[session]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const card = screen.getByTestId('kanban-card-s1')
    fireEvent.click(card)

    expect(mockOnSessionSelect).toHaveBeenCalledWith('s1')
  })

  it('displays session details on cards', () => {
    const session = mockSession({
      id: 's1',
      slug: 'detailed-session',
      status: 'running',
      branch: 'feature/test',
      prUrl: 'https://github.com/test/repo/pull/123',
    })
    render(<KanbanView sessions={[session]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    expect(screen.getByText('detailed-session')).toBeTruthy()
    expect(screen.getByText(/#123/)).toBeTruthy()
  })

  it('shows attention indicators on cards', () => {
    const session = mockSession({
      id: 's1',
      slug: 'attention-session',
      status: 'pending',
      needsAttention: true,
      attentionReasons: ['failed', 'waiting_for_feedback'],
    })
    render(<KanbanView sessions={[session]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const card = screen.getByTestId('kanban-card-s1')
    expect(card.className).toContain('border-amber-500')
  })

  it('displays connection dots when multiple connections exist', () => {
    connections.value = [
      { id: 'conn-1', label: 'Conn 1', baseUrl: 'http://test1', token: 'token1', color: '#ff0000' },
      { id: 'conn-2', label: 'Conn 2', baseUrl: 'http://test2', token: 'token2', color: '#00ff00' },
    ]
    activeId.value = 'conn-1'

    render(<KanbanView sessions={[]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const dots = screen.getAllByLabelText('Switch connection')
    expect(dots).toHaveLength(2)
  })

  it('does not display connection dots for single connection', () => {
    connections.value = [
      { id: 'conn-1', label: 'Single Conn', baseUrl: 'http://test', token: 'token', color: '#ff0000' },
    ]
    activeId.value = 'conn-1'

    render(<KanbanView sessions={[]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const dots = screen.queryAllByLabelText('Switch connection')
    expect(dots).toHaveLength(0)
  })

  it('shows empty state when no sessions in column', () => {
    render(<KanbanView sessions={[]} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const emptyMessages = screen.getAllByText('No sessions')
    expect(emptyMessages).toHaveLength(3)
  })

  it('distributes sessions across columns correctly', () => {
    const sessions = [
      mockSession({ id: 's1', slug: 'run-1', status: 'running' }),
      mockSession({ id: 's2', slug: 'run-2', status: 'running' }),
      mockSession({ id: 's3', slug: 'pend-1', status: 'pending' }),
      mockSession({ id: 's4', slug: 'done-1', status: 'completed' }),
      mockSession({ id: 's5', slug: 'fail-1', status: 'failed' }),
    ]
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    expect(screen.getByText('run-1')).toBeTruthy()
    expect(screen.getByText('run-2')).toBeTruthy()
    expect(screen.getByText('pend-1')).toBeTruthy()
    expect(screen.getByText('done-1')).toBeTruthy()
    expect(screen.getByText('fail-1')).toBeTruthy()
  })

  it('shows correct count badges in column headers', () => {
    const sessions = [
      mockSession({ id: 's1', status: 'running' }),
      mockSession({ id: 's2', status: 'running' }),
      mockSession({ id: 's3', status: 'pending' }),
      mockSession({ id: 's4', status: 'completed' }),
    ]
    render(<KanbanView sessions={sessions} dags={mockDags} onSessionSelect={mockOnSessionSelect} />)

    const counts = screen.getAllByText(/^[0-9]+$/)
    const countValues = counts.map(el => el.textContent)
    expect(countValues).toContain('2')
    expect(countValues).toContain('1')
  })
})
