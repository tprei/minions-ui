import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signal } from '@preact/signals'
import { ConnectionRail } from '../../src/connections/ConnectionRail'
import * as store from '../../src/connections/store'
import type { Connection } from '../../src/connections/types'
import type { ConnectionStore } from '../../src/state/types'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'

vi.mock('../../src/connections/store', () => ({
  connections: signal<Connection[]>([]),
  activeId: signal<string | null>(null),
  setActive: vi.fn(),
  getAllStores: vi.fn(() => new Map()),
}))

vi.mock('../../src/hooks/useHaptics', () => ({
  useHaptics: () => ({ vibrate: vi.fn(), supported: true }),
}))

function mockConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    label: 'Alpha',
    baseUrl: 'https://a.example.com',
    token: 'tok',
    color: '#3b82f6',
    ...overrides,
  }
}

function mockSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'session',
    status: 'running',
    command: '/task',
    mode: 'task',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    conversation: [],
    ...overrides,
  }
}

function mockDagNode(overrides: Partial<ApiDagNode> = {}): ApiDagNode {
  return {
    id: 'node-1',
    slug: 'node-1',
    status: 'pending',
    dependencies: [],
    dependents: [],
    ...overrides,
  }
}

function mockDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'd1',
    rootTaskId: 'root',
    nodes: {},
    status: 'pending',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockStore(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
): Partial<ConnectionStore> {
  return {
    sessions: signal(sessions) as ConnectionStore['sessions'],
    dags: signal(dags) as ConnectionStore['dags'],
  }
}

describe('ConnectionRail', () => {
  let connectionsSignal: ReturnType<typeof signal<Connection[]>>
  let activeIdSignal: ReturnType<typeof signal<string | null>>

  beforeEach(() => {
    connectionsSignal = signal<Connection[]>([])
    activeIdSignal = signal<string | null>(null)
    ;(vi.mocked(store).connections as typeof connectionsSignal) = connectionsSignal
    ;(vi.mocked(store).activeId as typeof activeIdSignal) = activeIdSignal
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when there are no connections', () => {
    const { container } = render(<ConnectionRail onManage={vi.fn()} />)
    expect(container.querySelector('[data-testid="connection-rail"]')).toBeNull()
  })

  it('renders an avatar for each connection', () => {
    connectionsSignal.value = [
      mockConn({ id: 'c1', label: 'Alpha' }),
      mockConn({ id: 'c2', label: 'Beta', color: '#10b981' }),
    ]

    render(<ConnectionRail onManage={vi.fn()} />)

    expect(screen.getByTestId('connection-rail')).toBeTruthy()
    expect(screen.getByTestId('rail-conn-c1')).toBeTruthy()
    expect(screen.getByTestId('rail-conn-c2')).toBeTruthy()
  })

  it('renders the manage button', () => {
    connectionsSignal.value = [mockConn()]
    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('connection-rail-manage')).toBeTruthy()
  })

  it('shows the active indicator on the active connection only', () => {
    connectionsSignal.value = [
      mockConn({ id: 'c1', label: 'Alpha' }),
      mockConn({ id: 'c2', label: 'Beta' }),
    ]
    activeIdSignal.value = 'c2'

    render(<ConnectionRail onManage={vi.fn()} />)

    expect(screen.queryByTestId('rail-active-indicator-c1')).toBeNull()
    expect(screen.getByTestId('rail-active-indicator-c2')).toBeTruthy()
  })

  it('exposes aria-current on the active button', () => {
    connectionsSignal.value = [mockConn({ id: 'c1' }), mockConn({ id: 'c2', label: 'Beta' })]
    activeIdSignal.value = 'c1'

    render(<ConnectionRail onManage={vi.fn()} />)

    expect(screen.getByTestId('rail-conn-c1').getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('rail-conn-c2').getAttribute('aria-current')).toBeNull()
  })

  it('uses the connection color as the avatar background', () => {
    connectionsSignal.value = [mockConn({ id: 'c1', color: '#ec4899' })]

    render(<ConnectionRail onManage={vi.fn()} />)

    const btn = screen.getByTestId('rail-conn-c1') as HTMLElement
    expect(btn.style.backgroundColor).toMatch(/rgb\(236,\s*72,\s*153\)|#ec4899/i)
  })

  it('renders initials from a single-word label', () => {
    connectionsSignal.value = [mockConn({ id: 'c1', label: 'Alpha' })]
    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-conn-c1').textContent).toContain('AL')
  })

  it('renders initials from a multi-word label using first + last', () => {
    connectionsSignal.value = [mockConn({ id: 'c1', label: 'My Cool Minion' })]
    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-conn-c1').textContent).toContain('MM')
  })

  it('clicking an inactive avatar calls setActive', () => {
    connectionsSignal.value = [mockConn({ id: 'c1' }), mockConn({ id: 'c2', label: 'Beta' })]
    activeIdSignal.value = 'c1'

    render(<ConnectionRail onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('rail-conn-c2'))
    expect(store.setActive).toHaveBeenCalledWith('c2')
  })

  it('clicking the already-active avatar does not call setActive', () => {
    connectionsSignal.value = [mockConn({ id: 'c1' })]
    activeIdSignal.value = 'c1'

    render(<ConnectionRail onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('rail-conn-c1'))
    expect(store.setActive).not.toHaveBeenCalled()
  })

  it('clicking manage button calls onManage', () => {
    connectionsSignal.value = [mockConn()]
    const onManage = vi.fn()

    render(<ConnectionRail onManage={onManage} />)

    fireEvent.click(screen.getByTestId('connection-rail-manage'))
    expect(onManage).toHaveBeenCalledTimes(1)
  })

  it('shows unread badge when sessions need attention', () => {
    const conn = mockConn({ id: 'c1' })
    connectionsSignal.value = [conn]

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([
        [
          conn.id,
          mockStore(
            [mockSession({ needsAttention: true, attentionReasons: ['failed'] })],
            [],
          ) as ConnectionStore,
        ],
      ]),
    )

    render(<ConnectionRail onManage={vi.fn()} />)

    const badge = screen.getByTestId('rail-unread-c1')
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('1')
  })

  it('caps unread count display at 9+', () => {
    const conn = mockConn({ id: 'c1' })
    connectionsSignal.value = [conn]

    const sessions = Array.from({ length: 12 }, (_, i) =>
      mockSession({ id: `s${i}`, needsAttention: true, attentionReasons: ['failed'] }),
    )

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore(sessions, []) as ConnectionStore]]),
    )

    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-unread-c1').textContent).toBe('9+')
  })

  it('shows failed dot when a DAG node has failed and there are no unreads', () => {
    const conn = mockConn({ id: 'c1' })
    connectionsSignal.value = [conn]

    const dag = mockDag({
      nodes: {
        n1: mockDagNode({ status: 'completed' }),
        n2: mockDagNode({ status: 'failed' }),
      },
    })

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore([], [dag]) as ConnectionStore]]),
    )

    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-failed-c1')).toBeTruthy()
    expect(screen.queryByTestId('rail-unread-c1')).toBeNull()
  })

  it('prefers the unread badge over the failed dot when both apply', () => {
    const conn = mockConn({ id: 'c1' })
    connectionsSignal.value = [conn]

    const dag = mockDag({
      nodes: {
        n1: mockDagNode({ status: 'failed' }),
      },
    })

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([
        [
          conn.id,
          mockStore(
            [mockSession({ needsAttention: true, attentionReasons: ['failed'] })],
            [dag],
          ) as ConnectionStore,
        ],
      ]),
    )

    render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-unread-c1')).toBeTruthy()
    expect(screen.queryByTestId('rail-failed-c1')).toBeNull()
  })

  it('aria-label includes counts when there are unread or failures', () => {
    const conn = mockConn({ id: 'c1', label: 'Alpha' })
    connectionsSignal.value = [conn]

    const dag = mockDag({
      nodes: { n1: mockDagNode({ status: 'failed' }) },
    })

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([
        [
          conn.id,
          mockStore(
            [mockSession({ needsAttention: true, attentionReasons: ['failed'] })],
            [dag],
          ) as ConnectionStore,
        ],
      ]),
    )

    render(<ConnectionRail onManage={vi.fn()} />)
    const aria = screen.getByTestId('rail-conn-c1').getAttribute('aria-label')
    expect(aria).toContain('Alpha')
    expect(aria).toContain('1 unread')
    expect(aria).toContain('1 failed')
  })

  it('reactively updates when active connection changes', () => {
    connectionsSignal.value = [mockConn({ id: 'c1' }), mockConn({ id: 'c2', label: 'Beta' })]
    activeIdSignal.value = 'c1'

    const { rerender } = render(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.getByTestId('rail-active-indicator-c1')).toBeTruthy()

    activeIdSignal.value = 'c2'
    rerender(<ConnectionRail onManage={vi.fn()} />)
    expect(screen.queryByTestId('rail-active-indicator-c1')).toBeNull()
    expect(screen.getByTestId('rail-active-indicator-c2')).toBeTruthy()
  })

  it('keyboard accessible via Enter on a button', () => {
    connectionsSignal.value = [mockConn({ id: 'c1' }), mockConn({ id: 'c2', label: 'Beta' })]
    activeIdSignal.value = 'c1'

    render(<ConnectionRail onManage={vi.fn()} />)

    const btn = screen.getByTestId('rail-conn-c2')
    btn.focus()
    fireEvent.click(btn)

    expect(store.setActive).toHaveBeenCalledWith('c2')
  })
})
