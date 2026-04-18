import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiSession, ApiDagGraph } from '../../src/api/types'

vi.mock('dagre', () => {
  function MockGraph(this: {
    nodePositions: Record<string, { x: number; y: number }>
    nodeCount: number
    setDefaultEdgeLabel: ReturnType<typeof vi.fn>
    setGraph: ReturnType<typeof vi.fn>
    setNode: ReturnType<typeof vi.fn>
    setEdge: ReturnType<typeof vi.fn>
    node: ReturnType<typeof vi.fn>
    graph: ReturnType<typeof vi.fn>
  }) {
    this.nodePositions = {}
    this.nodeCount = 0
    this.setDefaultEdgeLabel = vi.fn()
    this.setGraph = vi.fn()
    this.setNode = vi.fn((id: string) => {
      this.nodePositions[id] = { x: 120 + this.nodeCount * 240, y: 50 + this.nodeCount * 100 }
      this.nodeCount++
    })
    this.setEdge = vi.fn()
    this.node = vi.fn((id: string) => this.nodePositions[id] || { x: 120, y: 50 })
    this.graph = vi.fn(() => ({ width: this.nodeCount * 240, height: this.nodeCount * 100 }))
  }

  return {
    default: {
      graphlib: { Graph: MockGraph },
      layout: vi.fn(),
    },
    graphlib: { Graph: MockGraph },
    layout: vi.fn(),
  }
})

vi.mock('@reactflow/core', () => ({
  MarkerType: { ArrowClosed: 'arrowClosed' },
}))

function makeSession(overrides: Partial<ApiSession> & { id: string; slug: string }): ApiSession {
  return {
    status: 'running',
    command: '/task test',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function makeDag(overrides: Partial<ApiDagGraph> & { id: string }): ApiDagGraph {
  return {
    rootTaskId: 'node-1',
    nodes: {},
    status: 'running',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('universe-layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty arrays for empty input', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const result = layoutUniverse([], [], false)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('lays out standalone sessions in a grid', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 's1', slug: 'alpha' }),
      makeSession({ id: 's2', slug: 'beta' }),
      makeSession({ id: 's3', slug: 'gamma' }),
      makeSession({ id: 's4', slug: 'delta' }),
    ]
    const result = layoutUniverse(sessions, [], false)

    expect(result.nodes).toHaveLength(4)
    expect(result.edges).toHaveLength(0)

    const positions = result.nodes.map((n) => n.position)
    expect(positions[0].y).toBe(positions[1].y)
    expect(positions[1].y).toBe(positions[2].y)
    expect(positions[3].y).toBeGreaterThan(positions[0].y)
  })

  it('assigns correct node types to standalone sessions', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [makeSession({ id: 's1', slug: 'alpha' })]
    const result = layoutUniverse(sessions, [], false)

    expect(result.nodes[0].data.nodeType).toBe('standalone')
    expect(result.nodes[0].data.label).toBe('alpha')
    expect(result.nodes[0].data.session?.id).toBe('s1')
  })

  it('lays out DAG nodes with dependency edges', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'first',
          status: 'completed',
          dependencies: [],
          dependents: ['n2'],
        },
        'n2': {
          id: 'n2',
          slug: 'second',
          status: 'running',
          dependencies: ['n1'],
          dependents: [],
        },
      },
    })

    const result = layoutUniverse([], [dag], false)

    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)

    const edge = result.edges[0]
    expect(edge.source).toBe('n1')
    expect(edge.target).toBe('n2')
    expect(edge.data?.relationship).toBe('dag-dependency')
    expect(edge.animated).toBe(true)
  })

  it('lays out DAG nodes with correct node type', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'first',
          status: 'completed',
          dependencies: [],
          dependents: [],
        },
      },
    })

    const result = layoutUniverse([], [dag], false)

    expect(result.nodes[0].data.nodeType).toBe('dag')
    expect(result.nodes[0].data.dagNode?.id).toBe('n1')
    expect(result.nodes[0].data.groupId).toBe('dag-dag-1')
  })

  it('lays out parent-child tree with edges', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'parent', slug: 'parent-task', childIds: ['child1', 'child2'] }),
      makeSession({ id: 'child1', slug: 'child-one', parentId: 'parent' }),
      makeSession({ id: 'child2', slug: 'child-two', parentId: 'parent' }),
    ]

    const result = layoutUniverse(sessions, [], false)

    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toHaveLength(2)

    const edgeSources = result.edges.map((e) => e.source)
    expect(edgeSources).toEqual(['parent', 'parent'])

    const edgeTargets = result.edges.map((e) => e.target).sort()
    expect(edgeTargets).toEqual(['child1', 'child2'])

    for (const edge of result.edges) {
      expect(edge.data?.relationship).toBe('parent-child')
      expect(edge.style?.strokeDasharray).toBe('6 3')
    }
  })

  it('marks ci-fix edges with correct relationship', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'parent', slug: 'main-task', childIds: ['ci'] }),
      makeSession({ id: 'ci', slug: 'ci-fix-task', parentId: 'parent', mode: 'ci-fix' }),
    ]

    const result = layoutUniverse(sessions, [], false)

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].data?.relationship).toBe('ci-fix')
    expect(result.edges[0].style?.stroke).toBe('#f97316')
    expect(result.edges[0].style?.strokeDasharray).toBe('4 4')
  })

  it('excludes DAG-owned sessions from standalone/parent-child groups', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dagSession = makeSession({ id: 'dag-session', slug: 'dag-owned' })
    const standaloneSession = makeSession({ id: 'standalone', slug: 'alone' })

    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'dag-node',
          status: 'running',
          dependencies: [],
          dependents: [],
          session: dagSession,
        },
      },
    })

    const result = layoutUniverse([dagSession, standaloneSession], [dag], false)

    expect(result.nodes).toHaveLength(2)

    const dagNodes = result.nodes.filter((n) => n.data.nodeType === 'dag')
    const standaloneNodes = result.nodes.filter((n) => n.data.nodeType === 'standalone')
    expect(dagNodes).toHaveLength(1)
    expect(standaloneNodes).toHaveLength(1)
    expect(standaloneNodes[0].data.label).toBe('alone')
  })

  it('handles mixed groups positioned vertically', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'dag-task',
          status: 'completed',
          dependencies: [],
          dependents: [],
        },
      },
    })

    const standalone = makeSession({ id: 's1', slug: 'solo' })

    const result = layoutUniverse([standalone], [dag], false)

    expect(result.nodes).toHaveLength(2)

    const dagNode = result.nodes.find((n) => n.data.nodeType === 'dag')!
    const standaloneNode = result.nodes.find((n) => n.data.nodeType === 'standalone')!

    expect(standaloneNode.position.y).toBeGreaterThan(dagNode.position.y)
  })

  it('handles empty DAGs gracefully', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({ id: 'empty-dag', nodes: {} })
    const result = layoutUniverse([], [dag], false)
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('sets animated edges for running DAG nodes', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'first',
          status: 'completed',
          dependencies: [],
          dependents: ['n2'],
        },
        'n2': {
          id: 'n2',
          slug: 'second',
          status: 'running',
          dependencies: ['n1'],
          dependents: [],
        },
      },
    })

    const result = layoutUniverse([], [dag], false)

    const edge = result.edges.find((e) => e.target === 'n2')
    expect(edge?.animated).toBe(true)
  })

  it('sets animated edges for running parent-child sessions', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'p', slug: 'parent', childIds: ['c'], status: 'completed' }),
      makeSession({ id: 'c', slug: 'child', parentId: 'p', status: 'running' }),
    ]

    const result = layoutUniverse(sessions, [], false)

    expect(result.edges[0].animated).toBe(true)
  })

  it('uses dark mode colors when isDark is true', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': {
          id: 'n1',
          slug: 'first',
          status: 'completed',
          dependencies: [],
          dependents: ['n2'],
        },
        'n2': {
          id: 'n2',
          slug: 'second',
          status: 'pending',
          dependencies: ['n1'],
          dependents: [],
        },
      },
    })

    const darkResult = layoutUniverse([], [dag], true)
    const lightResult = layoutUniverse([], [dag], false)

    expect(darkResult.edges[0].style?.stroke).toBe('#9ca3af')
    expect(lightResult.edges[0].style?.stroke).toBe('#6b7280')
  })

  it('uses universeNode type for all nodes', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 's1', slug: 'solo' }),
      makeSession({ id: 'p', slug: 'parent', childIds: ['c'] }),
      makeSession({ id: 'c', slug: 'child', parentId: 'p' }),
    ]
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        'n1': { id: 'n1', slug: 'dag-task', status: 'pending', dependencies: [], dependents: [] },
      },
    })

    const result = layoutUniverse(sessions, [dag], false)

    for (const node of result.nodes) {
      expect(node.type).toBe('universeNode')
    }
  })

  it('handles multiple DAGs', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag1 = makeDag({
      id: 'dag-1',
      nodes: {
        'a': { id: 'a', slug: 'alpha', status: 'completed', dependencies: [], dependents: [] },
      },
    })
    const dag2 = makeDag({
      id: 'dag-2',
      nodes: {
        'b': { id: 'b', slug: 'beta', status: 'running', dependencies: [], dependents: [] },
      },
    })

    const result = layoutUniverse([], [dag1, dag2], false)

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0].data.groupId).toBe('dag-dag-1')
    expect(result.nodes[1].data.groupId).toBe('dag-dag-2')
  })

  it('handles deep parent-child trees', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
      makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
      makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
    ]

    const result = layoutUniverse(sessions, [], false)

    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toHaveLength(2)

    const edgePairs = result.edges.map((e) => `${e.source}->${e.target}`)
    expect(edgePairs).toContain('root->mid')
    expect(edgePairs).toContain('mid->leaf')
  })

  it('exports NODE_WIDTH and NODE_HEIGHT constants', async () => {
    const { NODE_WIDTH, NODE_HEIGHT } = await import('../../src/components/universe-layout')
    expect(NODE_WIDTH).toBe(240)
    expect(NODE_HEIGHT).toBe(100)
  })

  it('handles child session whose parent is a standalone (auto-discovers tree)', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'orphan-child', slug: 'child', parentId: 'found-parent' }),
      makeSession({ id: 'found-parent', slug: 'parent', childIds: ['orphan-child'] }),
    ]

    const result = layoutUniverse(sessions, [], false)

    const pcNodes = result.nodes.filter((n) => n.data.nodeType === 'parent-child')
    expect(pcNodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
  })
})
