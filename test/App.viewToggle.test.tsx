import { render, screen, fireEvent, within } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../src/api/types'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
}))

vi.mock('@reactflow/core', () => ({
  ReactFlow: vi.fn(({ nodes, nodeTypes, children }) => (
    <div data-testid="react-flow" data-node-count={nodes?.length || 0}>
      {nodes?.map((n: { id: string; type: string; data: Record<string, unknown> }) => {
        const Comp = nodeTypes?.[n.type]
        return Comp ? (
          <div key={n.id} data-testid={`flow-node-${n.id}`}>
            <Comp data={n.data} />
          </div>
        ) : (
          <div key={n.id} data-testid={`flow-node-${n.id}`}>
            {String(n.data?.label ?? n.id)}
          </div>
        )
      })}
      {children}
    </div>
  )),
  ReactFlowProvider: vi.fn(({ children }) => <>{children}</>),
  useReactFlow: vi.fn(() => ({
    setCenter: vi.fn(),
    fitBounds: vi.fn(),
    fitView: vi.fn(),
  })),
  useNodesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
  useEdgesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
  MarkerType: { ArrowClosed: 'arrowClosed' },
  Handle: vi.fn(() => null),
  Position: { Top: 'top', Bottom: 'bottom' },
}))

vi.mock('@reactflow/background', () => ({
  Background: vi.fn(() => <div data-testid="background" />),
}))

vi.mock('@reactflow/controls', () => ({
  Controls: vi.fn(() => <div data-testid="controls" />),
}))

vi.mock('@reactflow/minimap', () => ({
  MiniMap: vi.fn(() => <div data-testid="minimap" />),
}))

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
  return {
    default: {
      graphlib: { Graph: MockGraph },
      layout: vi.fn(),
    },
  }
})

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function stubFetch(sessions: ApiSession[] = [], dags: ApiDagGraph[] = []) {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' })
  const sendCommand = vi.fn().mockResolvedValue({ success: true })
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: sessions }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: dags }) })
    }
    if (url.includes('/api/messages')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      sendMessage(body)
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: { ok: true, sessionId: body.sessionId ?? 's1' } }) })
    }
    if (url.includes('/api/commands')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      sendCommand(body)
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: { success: true } }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, sendMessage, sendCommand }
}

function setDesktop(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: isDesktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function session(over: Partial<ApiSession> = {}): ApiSession {
  return {
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
    ...over,
  }
}

function seedConnection() {
  localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
    version: 1,
    connections: [
      { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
    ],
    activeId: 'c1',
  }))
}

async function resetViewMode() {
  const mod = await import('../src/App')
  mod.viewMode.value = 'list'
}

describe('App view toggle', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
    setDesktop(true)
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders ViewToggle with List selected by default', async () => {
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    const toggle = await screen.findByTestId('view-toggle')
    const listBtn = within(toggle).getByTestId('view-toggle-list')
    const canvasBtn = within(toggle).getByTestId('view-toggle-canvas')
    expect(listBtn.getAttribute('aria-selected')).toBe('true')
    expect(canvasBtn.getAttribute('aria-selected')).toBe('false')
  })

  it('switches to canvas view when Canvas tab clicked on desktop', async () => {
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByText('brave-fox')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))

    const canvasPane = await screen.findByTestId('canvas-pane')
    expect(canvasPane).toBeTruthy()
    expect(within(canvasPane).getByTestId('universe-canvas')).toBeTruthy()
  })

  it('switching back to List hides the canvas pane', async () => {
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-canvas'))
    await screen.findByTestId('canvas-pane')

    fireEvent.click(screen.getByTestId('view-toggle-list'))
    expect(screen.queryByTestId('canvas-pane')).toBeNull()
    await screen.findByTestId('session-item-s1')
  })

  it('clicking a node in canvas opens detail popup with Open Chat button', async () => {
    seedConnection()
    stubFetch([session({ id: 's1', slug: 'brave-fox' })])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-canvas'))
    const node = await screen.findByTestId('universe-node-s1')
    fireEvent.click(node)
    expect(await screen.findByText('Open Chat')).toBeTruthy()
  })

  it('Open Chat from canvas popup switches to list and selects session', async () => {
    seedConnection()
    stubFetch([session({ id: 's1', slug: 'brave-fox' })])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-canvas'))
    const node = await screen.findByTestId('universe-node-s1')
    fireEvent.click(node)
    fireEvent.click(await screen.findByText('Open Chat'))

    // Chat pane renders the upgrade notice because the mock minion
    // does not advertise the 'transcript' feature.
    await screen.findByTestId('transcript-upgrade-notice')
    expect(screen.queryByTestId('canvas-pane')).toBeNull()
  })

  it('renders mobile full-screen canvas modal with close button on mobile', async () => {
    setDesktop(false)
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-canvas'))

    const modal = await screen.findByTestId('canvas-mobile-modal')
    expect(modal).toBeTruthy()
    expect(within(modal).getByTestId('universe-canvas')).toBeTruthy()

    fireEvent.click(within(modal).getByTestId('canvas-mobile-close'))
    expect(screen.queryByTestId('canvas-mobile-modal')).toBeNull()
  })

  it('renders the Ship tab in the view toggle', async () => {
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    const toggle = await screen.findByTestId('view-toggle')
    expect(within(toggle).getByTestId('view-toggle-ship')).toBeTruthy()
  })

  it('switches to ship view when Ship tab clicked on desktop', async () => {
    seedConnection()
    const shipDag: ApiDagGraph = {
      id: 'ship-1',
      rootTaskId: 'n1',
      nodes: {
        n1: { id: 'n1', slug: 'ship-node', status: 'landed', dependencies: [], dependents: [] },
      },
      status: 'running',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }
    stubFetch([session()], [shipDag])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-ship'))
    const shipPane = await screen.findByTestId('ship-pane')
    expect(shipPane).toBeTruthy()
    expect(within(shipPane).getByTestId('ship-pipeline-board-ship-1')).toBeTruthy()
  })

  it('shows the empty ship state when no DAG qualifies as a ship pipeline', async () => {
    seedConnection()
    stubFetch([session()])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-ship'))
    expect(await screen.findByTestId('ship-pipeline-empty')).toBeTruthy()
  })

  it('renders mobile full-screen ship modal with close button on mobile', async () => {
    setDesktop(false)
    seedConnection()
    const shipDag: ApiDagGraph = {
      id: 'ship-m',
      rootTaskId: 'n1',
      nodes: {
        n1: { id: 'n1', slug: 'ship-node', status: 'landed', dependencies: [], dependents: [] },
      },
      status: 'running',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }
    stubFetch([session()], [shipDag])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-ship'))
    const modal = await screen.findByTestId('ship-mobile-modal')
    expect(modal).toBeTruthy()

    fireEvent.click(within(modal).getByTestId('ship-mobile-close'))
    expect(screen.queryByTestId('ship-mobile-modal')).toBeNull()
  })

  it('canvas sendReply callback calls /api/messages', async () => {
    seedConnection()
    const { sendMessage } = stubFetch([session({ id: 's1', slug: 'brave-fox', quickActions: [{ type: 'retry', label: 'Retry', message: 'retry please' }] })])
    await resetViewMode()
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('view-toggle-canvas'))
    const node = await screen.findByTestId('universe-node-s1')
    fireEvent.contextMenu(node.parentElement!, { clientX: 10, clientY: 10 })

    const retryBtn = await screen.findByText('Retry')
    fireEvent.click(retryBtn)

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', text: 'retry please' }))
    })
  })
})
