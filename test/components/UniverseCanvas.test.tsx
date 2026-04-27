import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import {
  UniverseCanvas,
  loadPersistedViewport,
  savePersistedViewport,
} from '../../src/components/UniverseCanvas'
import type { ApiSession, ApiDagGraph, FeedbackMetadata } from '../../src/api/types'

vi.mock('@reactflow/core', async () => {
  return {
    ReactFlow: vi.fn(({ nodes, nodeTypes, children }) => {
      return (
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
      )
    }),
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
  }
})

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

function createSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    repo: 'https://github.com/org/repo',
    branch: 'feature-branch',
    threadId: 123,
    chatId: -1001234567890,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function createDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'dag-1',
    rootTaskId: 'node-1',
    nodes: {
      'node-1': {
        id: 'node-1',
        slug: 'dag-root',
        status: 'running',
        dependencies: [],
        dependents: ['node-2'],
        session: createSession({ id: 'dag-session-1', slug: 'dag-root' }),
      },
      'node-2': {
        id: 'node-2',
        slug: 'dag-child',
        status: 'pending',
        dependencies: ['node-1'],
        dependents: [],
        session: createSession({ id: 'dag-session-2', slug: 'dag-child', status: 'pending' }),
      },
    },
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

const defaultProps = {
  sessions: [] as ApiSession[],
  dags: [] as ApiDagGraph[],
  isLoading: false,
  onSendReply: vi.fn().mockResolvedValue(undefined),
  onStopMinion: vi.fn().mockResolvedValue(undefined),
  onCloseSession: vi.fn().mockResolvedValue(undefined),
  onOpenThread: vi.fn(),
  isActionLoading: false,
}

describe('UniverseCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when no sessions or DAGs', () => {
    render(<UniverseCanvas {...defaultProps} />)
    expect(document.body.innerHTML).toContain('No active sessions')
    expect(document.body.innerHTML).toContain('Launch a task')
  })

  it('shows loading state', () => {
    render(<UniverseCanvas {...defaultProps} isLoading={true} />)
    expect(document.body.innerHTML).toContain('Loading universe')
  })

  it('renders React Flow canvas with sessions', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.querySelector('[data-testid="universe-canvas"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="react-flow"]')).toBeTruthy()
  })

  it('renders session slugs as node labels', () => {
    const sessions = [
      createSession({ id: 's1', slug: 'bold-meadow' }),
      createSession({ id: 's2', slug: 'calm-lake', status: 'completed' }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('bold-meadow')
    expect(document.body.innerHTML).toContain('calm-lake')
  })

  it('renders DAG nodes', () => {
    const dag = createDag()
    render(<UniverseCanvas {...defaultProps} dags={[dag]} />)
    expect(document.body.innerHTML).toContain('dag-root')
    expect(document.body.innerHTML).toContain('dag-child')
  })

  it('renders mixed sessions and DAGs', () => {
    const sessions = [createSession({ id: 'standalone-1', slug: 'free-session' })]
    const dag = createDag()
    render(<UniverseCanvas {...defaultProps} sessions={sessions} dags={[dag]} />)
    expect(document.body.innerHTML).toContain('free-session')
    expect(document.body.innerHTML).toContain('dag-root')
  })

  it('renders background, controls, and minimap', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.querySelector('[data-testid="background"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="controls"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="minimap"]')).toBeTruthy()
  })

  it('renders status badges on nodes', () => {
    const sessions = [
      createSession({ id: 's1', slug: 'running-one', status: 'running' }),
      createSession({ id: 's2', slug: 'done-one', status: 'completed' }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('Running')
    expect(document.body.innerHTML).toContain('Done')
  })

  it('renders attention badges for sessions needing attention', () => {
    const sessions = [
      createSession({
        id: 's1',
        slug: 'needs-help',
        needsAttention: true,
        attentionReasons: ['waiting_for_feedback'],
      }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('Waiting for reply')
  })

  it('renders all attention reasons as an icon stack', () => {
    const sessions = [
      createSession({
        id: 's1',
        slug: 'stacked',
        needsAttention: true,
        attentionReasons: ['failed', 'waiting_for_feedback', 'idle_long'],
      }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const stack = document.querySelector('[data-testid="attention-icon-stack"]')
    expect(stack).toBeTruthy()
    const icons = stack!.querySelectorAll('[data-attention-reason]')
    expect(icons).toHaveLength(3)
    expect(icons[0].getAttribute('data-attention-reason')).toBe('failed')
    expect(icons[1].getAttribute('data-attention-reason')).toBe('waiting_for_feedback')
    expect(icons[2].getAttribute('data-attention-reason')).toBe('idle_long')
  })

  it('renders PR links on nodes with PRs', () => {
    const sessions = [
      createSession({
        id: 's1',
        slug: 'has-pr',
        prUrl: 'https://github.com/org/repo/pull/42',
      }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('#42')
  })

  it('renders node type labels', () => {
    const dag = createDag()
    render(<UniverseCanvas {...defaultProps} dags={[dag]} />)
    expect(document.body.innerHTML).toContain('DAG')
  })

  it('opens context menu on right-click and shows Send Reply (no Telegram items)', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

    const node = document.querySelector('[data-testid="universe-node-session-1"]')
    expect(node).toBeTruthy()

    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 150, clientY: 200 })
      expect(document.body.innerHTML).toContain('Send Reply')
      expect(document.body.innerHTML).not.toContain('Open in Telegram')
    }
  })

  it('does not render canvas when loading with no data', () => {
    render(<UniverseCanvas {...defaultProps} isLoading={true} />)
    expect(document.querySelector('[data-testid="universe-canvas"]')).toBeFalsy()
  })

  it('renders parent-child relationships', () => {
    const parent = createSession({
      id: 'parent-1',
      slug: 'parent-task',
      childIds: ['child-1'],
    })
    const child = createSession({
      id: 'child-1',
      slug: 'child-task',
      parentId: 'parent-1',
    })
    render(<UniverseCanvas {...defaultProps} sessions={[parent, child]} />)
    expect(document.body.innerHTML).toContain('parent-task')
    expect(document.body.innerHTML).toContain('child-task')
    expect(document.body.innerHTML).toContain('Tree')
  })

  it('renders branch name when no PR URL', () => {
    const sessions = [
      createSession({
        id: 's1',
        slug: 'branch-only',
        branch: 'feat/new-thing',
      }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('feat/new-thing')
  })

  it('renders relative time on nodes', () => {
    const sessions = [createSession({ id: 's1', slug: 'timed-session' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.body.innerHTML).toContain('just now')
  })

  it('passes full-height canvas style', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const canvas = document.querySelector('[data-testid="universe-canvas"]') as HTMLElement
    expect(canvas.style.height).toBe('calc(100vh - 120px)')
  })

  it('calls onNodeSelect when a node is clicked', () => {
    const onNodeSelect = vi.fn()
    const sessions = [createSession({ id: 's1', slug: 'clickable' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} onNodeSelect={onNodeSelect} />)

    const node = document.querySelector('[data-testid="universe-node-s1"]')
    if (node) {
      fireEvent.click(node)
      expect(onNodeSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    }
  })

  it('context menu shows "Open parent" for a child session', () => {
    const parent = createSession({ id: 'parent-1', slug: 'parent-task', childIds: ['child-1'] })
    const child = createSession({ id: 'child-1', slug: 'child-task', parentId: 'parent-1' })
    render(<UniverseCanvas {...defaultProps} sessions={[parent, child]} />)

    const node = document.querySelector('[data-testid="universe-node-child-1"]')
    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 50, clientY: 50 })
      expect(document.body.innerHTML).toContain('Open parent')
    } else {
      throw new Error('child node not found')
    }
  })

  it('context menu shows "View in DAG" for a DAG-member session', () => {
    const dag = createDag()
    render(<UniverseCanvas {...defaultProps} dags={[dag]} />)

    const node = document.querySelector('[data-testid="universe-node-dag-session-1"]')
    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 50, clientY: 50 })
      expect(document.body.innerHTML).toContain('View in DAG')
    } else {
      throw new Error('dag node not found')
    }
  })

  it('context menu shows "Retry node" when DAG node status is ci-failed', () => {
    const dag = createDag({
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'dag-root',
          status: 'ci-failed',
          dependencies: [],
          dependents: [],
          session: createSession({ id: 'dag-session-1', slug: 'dag-root', status: 'running' }),
        },
      },
    })
    render(<UniverseCanvas {...defaultProps} dags={[dag]} />)

    const node = document.querySelector('[data-testid="universe-node-dag-session-1"]')
    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 50, clientY: 50 })
      expect(document.body.innerHTML).toContain('Retry node')
    } else {
      throw new Error('dag node not found')
    }
  })

  it('does not show "Open parent" for a standalone session', () => {
    const sessions = [createSession({ id: 's1', slug: 'alone' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

    const node = document.querySelector('[data-testid="universe-node-s1"]')
    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 50, clientY: 50 })
      expect(document.body.innerHTML).not.toContain('Open parent')
      expect(document.body.innerHTML).not.toContain('View in DAG')
    }
  })

  it('retry click sends /retry via onSendReply', () => {
    const onSendReply = vi.fn().mockResolvedValue(undefined)
    const dag = createDag({
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'dag-root',
          status: 'ci-failed',
          dependencies: [],
          dependents: [],
          session: createSession({ id: 'dag-session-1', slug: 'dag-root', status: 'running' }),
        },
      },
    })
    render(<UniverseCanvas {...defaultProps} dags={[dag]} onSendReply={onSendReply} />)

    const node = document.querySelector('[data-testid="universe-node-dag-session-1"]')
    if (node) {
      fireEvent.contextMenu(node.parentElement!, { clientX: 50, clientY: 50 })
      const retryButton = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Retry node')
      )
      expect(retryButton).toBeTruthy()
      if (retryButton) {
        fireEvent.click(retryButton)
        expect(onSendReply).toHaveBeenCalledWith('dag-session-1', '/retry')
      }
    } else {
      throw new Error('dag node not found')
    }
  })

  it('renders rebasing spinner indicator when node status is rebasing', () => {
    const dag = createDag({
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'rebasing-node',
          status: 'rebasing',
          dependencies: [],
          dependents: [],
          session: createSession({ id: 'dag-session-1', slug: 'rebasing-node', status: 'running' }),
        },
      },
    })
    render(<UniverseCanvas {...defaultProps} dags={[dag]} />)
    const rebasingIndicator = document.querySelector('[data-testid="rebasing-indicator"]')
    expect(rebasingIndicator).toBeTruthy()
  })

  it('does not render rebasing spinner for non-rebasing nodes', () => {
    const sessions = [createSession({ id: 's1', slug: 'normal-node', status: 'running' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.querySelector('[data-testid="rebasing-indicator"]')).toBeFalsy()
  })

  it('renders fit-to-screen FAB', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
    expect(fab).toBeTruthy()
  })

  it('calls fitView when FAB is clicked', async () => {
    const mockFitView = vi.fn()
    const mockModule = await import('@reactflow/core')
    vi.mocked(mockModule.useReactFlow).mockReturnValue({
      setCenter: vi.fn(),
      fitBounds: vi.fn(),
      fitView: mockFitView,
    } as unknown as ReturnType<typeof mockModule.useReactFlow>)

    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
    if (fab) {
      fireEvent.click(fab)
      expect(mockFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 400 })
    }
  })

  it('FAB has proper touch target size', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement
    expect(fab).toBeTruthy()
    if (fab) {
      expect(fab.style.width).toBe('48px')
      expect(fab.style.height).toBe('48px')
    }
  })

  it('FAB positioned in bottom-right corner', () => {
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement
    expect(fab).toBeTruthy()
    if (fab) {
      expect(fab.style.position).toBe('absolute')
      expect(fab.style.bottom).toBe('20px')
      expect(fab.style.right).toBe('20px')
    }
  })

  it('disables double-click zoom on ReactFlow', async () => {
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(mockModule.ReactFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        zoomOnDoubleClick: false,
      }),
      expect.anything()
    )
  })

  it('passes scale to node data', async () => {
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession({ id: 's1', slug: 'scaled-node' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

    const calls = vi.mocked(mockModule.ReactFlow).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]
    const nodes = lastCall[0].nodes

    if (nodes && nodes.length > 0) {
      expect(nodes[0].data.scale).toBeDefined()
      expect(typeof nodes[0].data.scale).toBe('number')
      expect(nodes[0].data.scale).toBeGreaterThan(0)
      expect(nodes[0].data.scale).toBeLessThanOrEqual(1)
    }
  })

  it('uses fitView and no defaultViewport when no viewportStorageKey is provided', async () => {
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession()]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const calls = vi.mocked(mockModule.ReactFlow).mock.calls
    const props = calls[calls.length - 1][0]
    expect(props.fitView).toBe(true)
    expect(props.defaultViewport).toBeUndefined()
  })

  it('passes defaultViewport from localStorage and disables fitView when persisted viewport is present', async () => {
    const storageKey = 'minions-ui:viewport:test-conn'
    window.localStorage.setItem(storageKey, JSON.stringify({ x: 42, y: -17, zoom: 0.75 }))
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession()]
    render(
      <UniverseCanvas
        {...defaultProps}
        sessions={sessions}
        viewportStorageKey={storageKey}
      />
    )
    const calls = vi.mocked(mockModule.ReactFlow).mock.calls
    const props = calls[calls.length - 1][0]
    expect(props.defaultViewport).toEqual({ x: 42, y: -17, zoom: 0.75 })
    expect(props.fitView).toBe(false)
    window.localStorage.removeItem(storageKey)
  })

  it('persists viewport to localStorage when ReactFlow emits onMoveEnd', async () => {
    const storageKey = 'minions-ui:viewport:onmove-test'
    window.localStorage.removeItem(storageKey)
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession()]
    render(
      <UniverseCanvas
        {...defaultProps}
        sessions={sessions}
        viewportStorageKey={storageKey}
      />
    )
    const calls = vi.mocked(mockModule.ReactFlow).mock.calls
    const props = calls[calls.length - 1][0]
    expect(typeof props.onMoveEnd).toBe('function')
    props.onMoveEnd?.(null as unknown as MouseEvent, { x: 100, y: 200, zoom: 1.25 })
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual({
      x: 100,
      y: 200,
      zoom: 1.25,
    })
    window.localStorage.removeItem(storageKey)
  })

  it('ignores invalid viewport stored in localStorage', async () => {
    const storageKey = 'minions-ui:viewport:bad'
    window.localStorage.setItem(storageKey, 'not-json')
    const mockModule = await import('@reactflow/core')
    const sessions = [createSession()]
    render(
      <UniverseCanvas
        {...defaultProps}
        sessions={sessions}
        viewportStorageKey={storageKey}
      />
    )
    const calls = vi.mocked(mockModule.ReactFlow).mock.calls
    const props = calls[calls.length - 1][0]
    expect(props.defaultViewport).toBeUndefined()
    expect(props.fitView).toBe(true)
    window.localStorage.removeItem(storageKey)
  })
})

describe('loadPersistedViewport / savePersistedViewport', () => {
  const key = 'minions-ui:viewport:unit'

  afterEach(() => {
    window.localStorage.removeItem(key)
  })

  it('returns null when no value is stored', () => {
    expect(loadPersistedViewport(key)).toBeNull()
  })

  it('round-trips a viewport through localStorage', () => {
    savePersistedViewport(key, { x: 11, y: 22, zoom: 1.5 })
    expect(loadPersistedViewport(key)).toEqual({ x: 11, y: 22, zoom: 1.5 })
  })

  it('returns null for malformed JSON', () => {
    window.localStorage.setItem(key, '{{')
    expect(loadPersistedViewport(key)).toBeNull()
  })

  it('returns null when zoom is not positive', () => {
    window.localStorage.setItem(key, JSON.stringify({ x: 0, y: 0, zoom: 0 }))
    expect(loadPersistedViewport(key)).toBeNull()
  })

  it('returns null when fields are missing or non-finite', () => {
    window.localStorage.setItem(key, JSON.stringify({ x: 1, y: 2 }))
    expect(loadPersistedViewport(key)).toBeNull()
    window.localStorage.setItem(key, JSON.stringify({ x: Infinity, y: 0, zoom: 1 }))
    expect(loadPersistedViewport(key)).toBeNull()
  })

  it('renders feedback badge on canvas node when session has feedback metadata', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const sessions = [
      createSession({
        id: 'feedback-1',
        slug: 'feedback-minion',
        metadata: feedbackMeta as unknown as Record<string, unknown>,
      }),
    ]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    const badge = document.querySelector('[data-testid="feedback-canvas-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('Feedback')
  })

  it('does not render feedback badge on canvas node for non-feedback sessions', () => {
    const sessions = [createSession({ id: 's1', slug: 'normal-session' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.querySelector('[data-testid="feedback-canvas-badge"]')).toBeFalsy()
  })

  it('renders Retry and Logs chips on a failed standalone node', () => {
    const sessions = [createSession({ id: 's-fail', slug: 'failed-one', status: 'failed' })]
    const onViewLogs = vi.fn()
    render(
      <UniverseCanvas {...defaultProps} sessions={sessions} onViewLogs={onViewLogs} />,
    )
    expect(document.querySelector('[data-testid="node-retry-chip-s-fail"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="node-logs-chip-s-fail"]')).toBeTruthy()
  })

  it('does not render failure chips on running nodes', () => {
    const sessions = [createSession({ id: 's-ok', slug: 'ok', status: 'running' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} onViewLogs={vi.fn()} />)
    expect(document.querySelector('[data-testid="node-retry-chip-s-ok"]')).toBeFalsy()
    expect(document.querySelector('[data-testid="node-logs-chip-s-ok"]')).toBeFalsy()
  })

  it('renders Retry chip on a ci-failed DAG node and clicking it sends /retry', () => {
    const onSendReply = vi.fn().mockResolvedValue(undefined)
    const dag = createDag({
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'dag-root',
          status: 'ci-failed',
          dependencies: [],
          dependents: [],
          session: createSession({ id: 'dag-session-1', slug: 'dag-root', status: 'running' }),
        },
      },
    })
    render(<UniverseCanvas {...defaultProps} dags={[dag]} onSendReply={onSendReply} onViewLogs={vi.fn()} />)
    const retryChip = document.querySelector('[data-testid="node-retry-chip-dag-session-1"]') as HTMLButtonElement | null
    expect(retryChip).toBeTruthy()
    if (retryChip) {
      fireEvent.click(retryChip)
      expect(onSendReply).toHaveBeenCalledWith('dag-session-1', '/retry')
    }
  })

  it('clicking Logs chip on a failed node calls onViewLogs with the session id', () => {
    const onViewLogs = vi.fn()
    const sessions = [createSession({ id: 's-fail-2', slug: 'failed-two', status: 'failed' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} onViewLogs={onViewLogs} />)
    const logsChip = document.querySelector('[data-testid="node-logs-chip-s-fail-2"]') as HTMLButtonElement | null
    expect(logsChip).toBeTruthy()
    if (logsChip) {
      fireEvent.click(logsChip)
      expect(onViewLogs).toHaveBeenCalledWith('s-fail-2')
    }
  })

  it('clicking a failure chip does not also trigger node selection', () => {
    const onNodeSelect = vi.fn()
    const onViewLogs = vi.fn()
    const sessions = [createSession({ id: 's-fail-3', slug: 'failed-three', status: 'failed' })]
    render(
      <UniverseCanvas
        {...defaultProps}
        sessions={sessions}
        onNodeSelect={onNodeSelect}
        onViewLogs={onViewLogs}
      />,
    )
    const logsChip = document.querySelector('[data-testid="node-logs-chip-s-fail-3"]') as HTMLButtonElement | null
    if (logsChip) {
      fireEvent.click(logsChip)
      expect(onNodeSelect).not.toHaveBeenCalled()
    }
  })

  it('omits the Logs chip when no onViewLogs handler is provided', () => {
    const sessions = [createSession({ id: 's-fail-4', slug: 'failed-four', status: 'failed' })]
    render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
    expect(document.querySelector('[data-testid="node-retry-chip-s-fail-4"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="node-logs-chip-s-fail-4"]')).toBeFalsy()
  })

  it('renders both feedback badge and node type label on canvas node', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'up',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const parent = createSession({
      id: 'parent-1',
      slug: 'parent-task',
      childIds: ['feedback-1'],
    })
    const feedbackSession = createSession({
      id: 'feedback-1',
      slug: 'feedback-child',
      parentId: 'parent-1',
      metadata: feedbackMeta as unknown as Record<string, unknown>,
    })
    render(<UniverseCanvas {...defaultProps} sessions={[parent, feedbackSession]} />)
    expect(document.querySelector('[data-testid="feedback-canvas-badge"]')).toBeTruthy()
    expect(document.body.innerHTML).toContain('Tree')
    expect(document.body.innerHTML).toContain('Feedback')
  })
})
