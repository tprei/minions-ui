import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { ConnectionPicker } from '../../src/connections/ConnectionPicker'
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

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(true),
}))

vi.mock('../../src/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({ current: null }),
}))

vi.mock('../../src/hooks/useHaptics', () => ({
  useHaptics: () => ({ vibrate: vi.fn() }),
}))

function createMockConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    label: 'Test Connection',
    baseUrl: 'http://localhost:8080',
    token: 'token',
    color: '#3b82f6',
    ...overrides,
  }
}

function createMockSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'test',
    status: 'running',
    command: '/task test',
    mode: 'task',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    conversation: [],
    ...overrides,
  }
}

function createMockDagNode(overrides: Partial<ApiDagNode> = {}): ApiDagNode {
  return {
    id: 'node-1',
    slug: 'node-1',
    status: 'pending',
    dependencies: [],
    dependents: [],
    ...overrides,
  }
}

function createMockDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'dag-1',
    rootTaskId: 'root-1',
    nodes: {},
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createMockStore(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
): Partial<ConnectionStore> {
  return {
    sessions: signal(sessions) as ConnectionStore['sessions'],
    dags: signal(dags) as ConnectionStore['dags'],
  }
}

describe('ConnectionPicker status indicators', () => {
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

  it('shows unread indicator on active connection trigger when attention is needed', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = conn.id

    const mockStore = createMockStore(
      [createMockSession({ needsAttention: true, attentionReasons: ['failed'] })],
      [],
    )

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    const unreadDot = screen.getByTestId('picker-trigger-unread')
    expect(unreadDot).toBeTruthy()
    expect(unreadDot.getAttribute('aria-label')).toBe('1 unread')
  })

  it('hides unread indicator when no attention needed', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = conn.id

    const mockStore = createMockStore([createMockSession()], [])

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    expect(screen.queryByTestId('picker-trigger-unread')).toBeFalsy()
  })

  it('shows DAG stats in connection list when DAGs exist', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    const dag = createMockDag({
      nodes: {
        'node-1': createMockDagNode({ status: 'completed' }),
        'node-2': createMockDagNode({ status: 'running' }),
        'node-3': createMockDagNode({ status: 'pending' }),
      },
    })

    const mockStore = createMockStore([], [dag])

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const dagStats = screen.getByTestId(`picker-dag-stats-${conn.id}`)
    expect(dagStats.textContent).toContain('1')
    expect(dagStats.textContent).toContain('/3')
  })

  it('shows failed count in DAG stats when failures exist', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    const dag = createMockDag({
      nodes: {
        'node-1': createMockDagNode({ status: 'completed' }),
        'node-2': createMockDagNode({ status: 'failed' }),
        'node-3': createMockDagNode({ status: 'ci-failed' }),
        'node-4': createMockDagNode({ status: 'pending' }),
      },
    })

    const mockStore = createMockStore([], [dag])

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const dagStats = screen.getByTestId(`picker-dag-stats-${conn.id}`)
    expect(dagStats.textContent).toContain('1/4')
    expect(dagStats.textContent).toContain('2 failed')
  })

  it('hides DAG stats when no DAGs exist', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    const mockStore = createMockStore([], [])

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    expect(screen.queryByTestId(`picker-dag-stats-${conn.id}`)).toBeFalsy()
  })

  it('shows unread indicator in connection list', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    const mockStore = createMockStore(
      [
        createMockSession({ needsAttention: true, attentionReasons: ['failed'] }),
        createMockSession({
          id: 'session-2',
          needsAttention: true,
          attentionReasons: ['interrupted'],
        }),
      ],
      [],
    )

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const unreadDot = screen.getByTestId(`picker-unread-${conn.id}`)
    expect(unreadDot).toBeTruthy()
    expect(unreadDot.getAttribute('aria-label')).toBe('2 unread')
  })

  it('shows both unread and DAG stats for a connection', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = null

    const dag = createMockDag({
      nodes: {
        'node-1': createMockDagNode({ status: 'completed' }),
        'node-2': createMockDagNode({ status: 'failed' }),
      },
    })

    const mockStore = createMockStore(
      [createMockSession({ needsAttention: true, attentionReasons: ['ci_fix'] })],
      [dag],
    )

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    expect(screen.getByTestId(`picker-unread-${conn.id}`)).toBeTruthy()
    const dagStats = screen.getByTestId(`picker-dag-stats-${conn.id}`)
    expect(dagStats.textContent).toContain('1/2')
    expect(dagStats.textContent).toContain('1 failed')
  })

  it('updates stats when store signals change', () => {
    const conn = createMockConnection()
    connectionsSignal.value = [conn]
    activeIdSignal.value = conn.id

    const sessionsSignal = signal<ApiSession[]>([])
    const dagsSignal = signal<ApiDagGraph[]>([])

    const mockStore = {
      sessions: sessionsSignal,
      dags: dagsSignal,
    }

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([[conn.id, mockStore as ConnectionStore]]),
    )

    const { rerender } = render(<ConnectionPicker onManage={vi.fn()} />)

    expect(screen.queryByTestId('picker-trigger-unread')).toBeFalsy()

    sessionsSignal.value = [
      createMockSession({ needsAttention: true, attentionReasons: ['failed'] }),
    ]

    rerender(<ConnectionPicker onManage={vi.fn()} />)

    expect(screen.getByTestId('picker-trigger-unread')).toBeTruthy()
  })

  it('handles multiple connections with different stats', () => {
    const conn1 = createMockConnection({ id: 'conn-1', label: 'Connection 1' })
    const conn2 = createMockConnection({ id: 'conn-2', label: 'Connection 2' })
    connectionsSignal.value = [conn1, conn2]
    activeIdSignal.value = null

    const store1 = createMockStore(
      [createMockSession({ needsAttention: true, attentionReasons: ['failed'] })],
      [],
    )

    const store2 = createMockStore(
      [],
      [
        createMockDag({
          nodes: {
            'node-1': createMockDagNode({ status: 'completed' }),
            'node-2': createMockDagNode({ status: 'running' }),
          },
        }),
      ],
    )

    vi.mocked(store.getAllStores).mockReturnValue(
      new Map([
        [conn1.id, store1 as ConnectionStore],
        [conn2.id, store2 as ConnectionStore],
      ]),
    )

    render(<ConnectionPicker onManage={vi.fn()} />)

    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    expect(screen.getByTestId(`picker-unread-${conn1.id}`)).toBeTruthy()
    expect(screen.queryByTestId(`picker-dag-stats-${conn1.id}`)).toBeFalsy()

    expect(screen.queryByTestId(`picker-unread-${conn2.id}`)).toBeFalsy()
    expect(screen.getByTestId(`picker-dag-stats-${conn2.id}`).textContent).toContain('1/2')
  })
})
