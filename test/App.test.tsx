import { render, screen } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../src/api/types'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@reactflow/core', () => ({
  ReactFlow: vi.fn(({ nodes, nodeTypes, children }) => (
    <div data-testid="react-flow">
      {nodes?.map((n: { id: string; type: string; data: Record<string, unknown> }) => {
        const Comp = nodeTypes?.[n.type]
        return Comp ? (
          <div key={n.id} data-testid={`flow-node-${n.id}`}>
            <Comp data={n.data} />
          </div>
        ) : (
          <div key={n.id}>{String(n.data?.label ?? n.id)}</div>
        )
      })}
      {children}
    </div>
  )),
  useNodesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
  useEdgesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
  MarkerType: { ArrowClosed: 'arrowClosed' },
  Handle: vi.fn(() => null),
  Position: { Top: 'top', Bottom: 'bottom' },
}))

vi.mock('@reactflow/background', () => ({ Background: vi.fn(() => null) }))
vi.mock('@reactflow/controls', () => ({ Controls: vi.fn(() => null) }))
vi.mock('@reactflow/minimap', () => ({ MiniMap: vi.fn(() => null) }))

vi.mock('dagre', () => {
  function MockGraph(this: {
    setDefaultEdgeLabel: ReturnType<typeof vi.fn>
    setGraph: ReturnType<typeof vi.fn>
    setNode: ReturnType<typeof vi.fn>
    setEdge: ReturnType<typeof vi.fn>
    node: ReturnType<typeof vi.fn>
    graph: ReturnType<typeof vi.fn>
  }) {
    this.setDefaultEdgeLabel = vi.fn()
    this.setGraph = vi.fn()
    this.setNode = vi.fn()
    this.setEdge = vi.fn()
    this.node = vi.fn(() => ({ x: 100, y: 100 }))
    this.graph = vi.fn(() => ({ width: 400, height: 300 }))
  }
  return { default: { graphlib: { Graph: MockGraph }, layout: vi.fn() } }
})

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function stubFetch(sessions: ApiSession[] = [], dags: ApiDagGraph[] = []) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: sessions }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: dags }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
  }))
}

describe('App', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders empty state "Connect a minion" when no connections', async () => {
    stubFetch()
    const App = (await import('../src/App')).default
    render(<App />)
    expect(screen.getByText('Connect a minion')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy()
  })

  it('renders header with connection label and sessions list when connection exists', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))

    const sessions: ApiSession[] = [
      {
        id: 's1',
        slug: 'brave-fox',
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
      },
    ]
    stubFetch(sessions)

    const App = (await import('../src/App')).default
    render(<App />)

    expect(screen.getByText('My Minion')).toBeTruthy()
    await screen.findByText('brave-fox')
  })

  it('clicking node opens NodeDetailPopup, then Open Chat opens ChatPanel', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))

    const sessions: ApiSession[] = [
      {
        id: 's1',
        slug: 'brave-fox',
        status: 'running',
        command: '/task foo',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        childIds: [],
        needsAttention: false,
        attentionReasons: [],
        quickActions: [],
        mode: 'task',
        conversation: [{ role: 'user', text: 'hello' }],
      },
    ]
    stubFetch(sessions)

    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByText('brave-fox')

    const node = screen.getByTestId('universe-node-s1')
    node.click()

    await screen.findByRole('button', { name: 'Open Chat' })

    const openChatBtn = screen.getByRole('button', { name: 'Open Chat' })
    openChatBtn.click()

    await screen.findByTestId('conversation-view')
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('ChatPanel close button removes the panel', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))

    const sessions: ApiSession[] = [
      {
        id: 's1',
        slug: 'swift-cat',
        status: 'running',
        command: '/task bar',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        childIds: [],
        needsAttention: false,
        attentionReasons: [],
        quickActions: [],
        mode: 'task',
        conversation: [],
      },
    ]
    stubFetch(sessions)

    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByText('swift-cat')

    const node = screen.getByTestId('universe-node-s1')
    node.click()

    await screen.findByRole('button', { name: 'Open Chat' })

    const openChatBtn = screen.getByRole('button', { name: 'Open Chat' })
    openChatBtn.click()

    await screen.findByTestId('chat-close-btn')

    const closeBtn = screen.getByTestId('chat-close-btn')
    closeBtn.click()

    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('chat-close-btn')).toBeNull()
  })
})
