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

  it('renders ship-mode sessions as a dedicated ship group with LR-rank edges', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({
        id: 'topic',
        slug: 'feature',
        mode: 'ship-plan',
        childIds: ['verify'],
      }),
      makeSession({
        id: 'verify',
        slug: 'verify-pr',
        mode: 'ship-verify',
        parentId: 'topic',
      }),
    ]

    const result = layoutUniverse(sessions, [], false)

    const shipNodes = result.nodes.filter((n) => n.data.nodeType === 'ship')
    expect(shipNodes).toHaveLength(2)
    expect(shipNodes.map((n) => n.data.label).sort()).toEqual(['feature', 'verify-pr'])
    expect(shipNodes.every((n) => n.data.groupId === 'ship-topic')).toBe(true)

    const shipEdges = result.edges.filter((e) => e.data?.relationship === 'ship')
    expect(shipEdges).toHaveLength(1)
    expect(shipEdges[0].source).toBe('topic')
    expect(shipEdges[0].target).toBe('verify')
    expect(shipEdges[0].animated).toBe(true)
  })

  it('keeps a lone ship-think session in the ship bucket, not standalone', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [makeSession({ id: 's1', slug: 'feat', mode: 'ship-think' })]

    const result = layoutUniverse(sessions, [], false)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].data.nodeType).toBe('ship')
    expect(result.nodes[0].data.groupId).toBe('ship-s1')
  })

  it('uses purple ship-edge stroke that flips with dark mode', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'p', slug: 'p', mode: 'ship-plan', childIds: ['c'] }),
      makeSession({ id: 'c', slug: 'c', mode: 'ship-verify', parentId: 'p' }),
    ]

    const lightResult = layoutUniverse(sessions, [], false)
    const darkResult = layoutUniverse(sessions, [], true)

    expect(lightResult.edges[0].style?.stroke).toBe('#7c3aed')
    expect(darkResult.edges[0].style?.stroke).toBe('#a78bfa')
  })

  it('does not pull non-ship descendants into the ship group', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({
        id: 'topic',
        slug: 'topic',
        mode: 'ship-plan',
        childIds: ['ship-c', 'task-c'],
      }),
      makeSession({ id: 'ship-c', slug: 'ship-c', mode: 'ship-verify', parentId: 'topic' }),
      makeSession({ id: 'task-c', slug: 'task-c', mode: 'task', parentId: 'topic' }),
    ]

    const result = layoutUniverse(sessions, [], false)

    const shipNodes = result.nodes.filter((n) => n.data.nodeType === 'ship')
    const standaloneNodes = result.nodes.filter((n) => n.data.nodeType === 'standalone')
    expect(shipNodes.map((n) => n.data.label).sort()).toEqual(['ship-c', 'topic'])
    expect(standaloneNodes.map((n) => n.data.label)).toEqual(['task-c'])
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

  it('animates DAG edges when the source (dependency) is running', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        n1: {
          id: 'n1',
          slug: 'first',
          status: 'running',
          dependencies: [],
          dependents: ['n2'],
        },
        n2: {
          id: 'n2',
          slug: 'second',
          status: 'pending',
          dependencies: ['n1'],
          dependents: [],
        },
      },
    })

    const result = layoutUniverse([], [dag], false)
    const edge = result.edges.find((e) => e.source === 'n1' && e.target === 'n2')
    expect(edge?.animated).toBe(true)
  })

  it('does not animate DAG edges when neither end is running', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        n1: {
          id: 'n1',
          slug: 'first',
          status: 'completed',
          dependencies: [],
          dependents: ['n2'],
        },
        n2: {
          id: 'n2',
          slug: 'second',
          status: 'pending',
          dependencies: ['n1'],
          dependents: [],
        },
      },
    })

    const result = layoutUniverse([], [dag], false)
    const edge = result.edges.find((e) => e.source === 'n1' && e.target === 'n2')
    expect(edge?.animated).toBe(false)
  })

  it('animates parent-child edges when the parent is running', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'p', slug: 'parent', childIds: ['c'], status: 'running' }),
      makeSession({ id: 'c', slug: 'child', parentId: 'p', status: 'completed' }),
    ]

    const result = layoutUniverse(sessions, [], false)
    expect(result.edges[0].animated).toBe(true)
  })

  it('does not animate parent-child edges when both ends are idle', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'p', slug: 'parent', childIds: ['c'], status: 'completed' }),
      makeSession({ id: 'c', slug: 'child', parentId: 'p', status: 'completed' }),
    ]

    const result = layoutUniverse(sessions, [], false)
    expect(result.edges[0].animated).toBe(false)
  })

  it('draws a cross-group edge from a DAG-owned parent to a standalone child', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dagSession = makeSession({ id: 'dag-sess', slug: 'dag-parent', childIds: ['orphan'] })
    const orphan = makeSession({
      id: 'orphan',
      slug: 'orphan-child',
      parentId: 'dag-sess',
      status: 'running',
    })
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        dn1: {
          id: 'dn1',
          slug: 'dag-node',
          status: 'ci-pending',
          dependencies: [],
          dependents: [],
          session: dagSession,
        },
      },
    })

    const result = layoutUniverse([dagSession, orphan], [dag], false)

    const cross = result.edges.find((e) => e.target === 'orphan')
    expect(cross).toBeDefined()
    expect(cross?.source).toBe('dn1')
    expect(cross?.data?.relationship).toBe('parent-child')
    expect(cross?.animated).toBe(true)
    expect(cross?.style?.opacity).toBe(0.7)
  })

  it('marks cross-group ci-fix edges with ci-fix styling and animates while parent is ci-pending', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dagSession = makeSession({
      id: 'dag-sess',
      slug: 'dag-parent',
      childIds: ['ci'],
      status: 'running',
    })
    const ciFix = makeSession({
      id: 'ci',
      slug: 'ci-fix',
      parentId: 'dag-sess',
      mode: 'ci-fix',
      status: 'pending',
    })
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        dn1: {
          id: 'dn1',
          slug: 'dag-node',
          status: 'ci-pending',
          dependencies: [],
          dependents: [],
          session: dagSession,
        },
      },
    })

    const result = layoutUniverse([dagSession, ciFix], [dag], false)

    const cross = result.edges.find((e) => e.target === 'ci')
    expect(cross).toBeDefined()
    expect(cross?.source).toBe('dn1')
    expect(cross?.data?.relationship).toBe('ci-fix')
    expect(cross?.style?.stroke).toBe('#f97316')
    expect(cross?.style?.strokeDasharray).toBe('4 4')
    expect(cross?.animated).toBe(true)
  })

  it('does not animate cross-group edges when parent is completed and child is idle', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dagSession = makeSession({
      id: 'dag-sess',
      slug: 'dag-parent',
      childIds: ['orphan'],
      status: 'completed',
    })
    const orphan = makeSession({
      id: 'orphan',
      slug: 'orphan-child',
      parentId: 'dag-sess',
      status: 'completed',
    })
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        dn1: {
          id: 'dn1',
          slug: 'dag-node',
          status: 'completed',
          dependencies: [],
          dependents: [],
          session: dagSession,
        },
      },
    })

    const result = layoutUniverse([dagSession, orphan], [dag], false)
    const cross = result.edges.find((e) => e.target === 'orphan')
    expect(cross?.animated).toBe(false)
  })

  it('does not draw cross-group edges for standalone sessions without DAG-owned parents', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const sessions = [
      makeSession({ id: 'a', slug: 'alpha' }),
      makeSession({ id: 'b', slug: 'beta' }),
    ]
    const result = layoutUniverse(sessions, [], false)
    expect(result.edges).toHaveLength(0)
  })

  it('does not animate cross-group non-ci-fix edges when parent is ci-pending', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const dagSession = makeSession({
      id: 'dag-sess',
      slug: 'dag-parent',
      childIds: ['orphan'],
    })
    const orphan = makeSession({
      id: 'orphan',
      slug: 'orphan-child',
      parentId: 'dag-sess',
      status: 'pending',
    })
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        dn1: {
          id: 'dn1',
          slug: 'dag-node',
          status: 'ci-pending',
          dependencies: [],
          dependents: [],
          session: dagSession,
        },
      },
    })

    const result = layoutUniverse([dagSession, orphan], [dag], false)
    const cross = result.edges.find((e) => e.target === 'orphan')
    expect(cross?.data?.relationship).toBe('parent-child')
    expect(cross?.animated).toBe(false)
  })

  it('renders ship coordinator (mode=ship) with stage in ship group', async () => {
    const { layoutUniverse } = await import('../../src/components/universe-layout')
    const coordinator = makeSession({
      id: 'coord',
      slug: 'feature-coordinator',
      mode: 'ship',
      stage: 'plan',
    })

    const result = layoutUniverse([coordinator], [], false)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].data.nodeType).toBe('ship')
    expect(result.nodes[0].data.groupId).toBe('ship-coord')
    expect(result.nodes[0].data.session?.stage).toBe('plan')
  })
})
