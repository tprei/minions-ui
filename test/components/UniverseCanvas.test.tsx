import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { UniverseCanvas } from '../../src/components/UniverseCanvas'
import type { ApiSession, ApiDagGraph } from '../../src/api/types'

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
})
