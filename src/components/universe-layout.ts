import dagre from 'dagre'
import type { Node, Edge } from '@reactflow/core'
import { MarkerType } from '@reactflow/core'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../api/types'
import { classifySessions } from '../state/hierarchy'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 100
const GROUP_GAP = 120
const GRID_COLUMNS = 3
const GRID_NODE_GAP_X = NODE_WIDTH + 40
const GRID_NODE_GAP_Y = NODE_HEIGHT + 40

export type EdgeRelationship = 'dag-dependency' | 'parent-child' | 'ci-fix' | 'ship'

export type UniverseNode = Node<{
  session?: ApiSession
  dagNode?: ApiDagNode
  label: string
  status: string
  groupId: string
  nodeType: 'dag' | 'parent-child' | 'standalone' | 'ship'
  dagProgressIndex?: number
  dagProgressTotal?: number
}>

export type UniverseEdge = Edge<{
  relationship: EdgeRelationship
}>

export function topologicalDagOrder(dagNodes: ApiDagNode[]): Map<string, number> {
  const byId = new Map<string, ApiDagNode>(dagNodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const order: string[] = []

  function visit(id: string): void {
    if (visited.has(id)) return
    const node = byId.get(id)
    if (!node) return
    visited.add(id)
    for (const dep of node.dependencies) visit(dep)
    order.push(id)
  }

  for (const node of dagNodes) visit(node.id)

  const result = new Map<string, number>()
  order.forEach((id, idx) => result.set(id, idx + 1))
  return result
}

interface LayoutGroup {
  id: string
  nodes: Node[]
  edges: Edge[]
  width: number
  height: number
}

function layoutDagGroup(dag: ApiDagGraph, isDark: boolean): LayoutGroup {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 })

  const dagNodes = Object.values(dag.nodes)

  for (const node of dagNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const edges: Edge[] = []
  for (const node of dagNodes) {
    for (const depId of node.dependencies) {
      g.setEdge(depId, node.id)
      const depNode = dag.nodes[depId]
      const animated = node.status === 'running' || depNode?.status === 'running'
      edges.push({
        id: `dag-${dag.id}-${depId}-${node.id}`,
        source: depId,
        target: node.id,
        type: 'smoothstep',
        animated,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isDark ? '#9ca3af' : '#6b7280',
        },
        style: { stroke: isDark ? '#9ca3af' : '#6b7280' },
        data: { relationship: 'dag-dependency' as EdgeRelationship },
      })
    }
  }

  dagre.layout(g)

  const order = topologicalDagOrder(dagNodes)
  const total = dagNodes.length

  const nodes: Node[] = dagNodes.map((dagNode) => {
    const pos = g.node(dagNode.id)
    return {
      id: dagNode.id,
      type: 'universeNode',
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: {
        session: dagNode.session,
        dagNode,
        label: dagNode.slug,
        status: dagNode.status,
        groupId: `dag-${dag.id}`,
        nodeType: 'dag' as const,
        dagProgressIndex: order.get(dagNode.id),
        dagProgressTotal: total,
      },
    }
  })

  const graphInfo = g.graph()
  const width = (graphInfo?.width ?? NODE_WIDTH) as number
  const height = (graphInfo?.height ?? NODE_HEIGHT) as number

  return { id: `dag-${dag.id}`, nodes, edges, width, height }
}

function layoutParentChildGroup(
  root: ApiSession,
  sessionById: Map<string, ApiSession>,
  isDark: boolean,
): LayoutGroup {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 })

  const visited = new Set<string>()
  const groupSessions: ApiSession[] = []
  const edges: Edge[] = []

  function walk(session: ApiSession): void {
    if (visited.has(session.id)) return
    visited.add(session.id)
    groupSessions.push(session)
    g.setNode(session.id, { width: NODE_WIDTH, height: NODE_HEIGHT })

    for (const childId of session.childIds) {
      const child = sessionById.get(childId)
      if (!child) continue

      const isCiFix = child.mode === 'ci-fix'
      const relationship: EdgeRelationship = isCiFix ? 'ci-fix' : 'parent-child'
      const animated = child.status === 'running' || session.status === 'running'

      edges.push({
        id: `pc-${session.id}-${childId}`,
        source: session.id,
        target: childId,
        type: 'smoothstep',
        animated,
        style: {
          stroke: isCiFix ? '#f97316' : (isDark ? '#60a5fa' : '#3b82f6'),
          strokeDasharray: isCiFix ? '4 4' : '6 3',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isCiFix ? '#f97316' : (isDark ? '#60a5fa' : '#3b82f6'),
        },
        data: { relationship },
      })

      g.setEdge(session.id, childId)
      walk(child)
    }
  }

  walk(root)
  dagre.layout(g)

  const nodes: Node[] = groupSessions.map((s) => {
    const pos = g.node(s.id)
    return {
      id: s.id,
      type: 'universeNode',
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: {
        session: s,
        label: s.slug,
        status: s.status,
        groupId: `pc-${root.id}`,
        nodeType: 'parent-child' as const,
      },
    }
  })

  const graphInfo = g.graph()
  const width = (graphInfo?.width ?? NODE_WIDTH) as number
  const height = (graphInfo?.height ?? NODE_HEIGHT) as number

  return { id: `pc-${root.id}`, nodes, edges, width, height }
}

function layoutShipGroup(
  root: ApiSession,
  sessionById: Map<string, ApiSession>,
  shipMembers: Set<string>,
  isDark: boolean,
): LayoutGroup {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 })

  const visited = new Set<string>()
  const groupSessions: ApiSession[] = []
  const edges: Edge[] = []
  const stroke = isDark ? '#a78bfa' : '#7c3aed'

  function walk(session: ApiSession): void {
    if (visited.has(session.id)) return
    visited.add(session.id)
    groupSessions.push(session)
    g.setNode(session.id, { width: NODE_WIDTH, height: NODE_HEIGHT })

    for (const childId of session.childIds) {
      if (!shipMembers.has(childId)) continue
      const child = sessionById.get(childId)
      if (!child) continue

      edges.push({
        id: `ship-${session.id}-${childId}`,
        source: session.id,
        target: childId,
        type: 'smoothstep',
        animated: child.status === 'running',
        style: { stroke, strokeDasharray: '6 3' },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        data: { relationship: 'ship' as EdgeRelationship },
      })

      g.setEdge(session.id, childId)
      walk(child)
    }
  }

  walk(root)
  dagre.layout(g)

  const nodes: Node[] = groupSessions.map((s) => {
    const pos = g.node(s.id)
    return {
      id: s.id,
      type: 'universeNode',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        session: s,
        label: s.slug,
        status: s.status,
        groupId: `ship-${root.id}`,
        nodeType: 'ship' as const,
      },
    }
  })

  const graphInfo = g.graph()
  const width = (graphInfo?.width ?? NODE_WIDTH) as number
  const height = (graphInfo?.height ?? NODE_HEIGHT) as number

  return { id: `ship-${root.id}`, nodes, edges, width, height }
}

function layoutStandaloneGroup(sessions: ApiSession[]): LayoutGroup {
  if (sessions.length === 0) {
    return { id: 'standalone', nodes: [], edges: [], width: 0, height: 0 }
  }

  const nodes: Node[] = sessions.map((s, i) => {
    const col = i % GRID_COLUMNS
    const row = Math.floor(i / GRID_COLUMNS)
    return {
      id: s.id,
      type: 'universeNode',
      position: {
        x: col * GRID_NODE_GAP_X,
        y: row * GRID_NODE_GAP_Y,
      },
      data: {
        session: s,
        label: s.slug,
        status: s.status,
        groupId: 'standalone',
        nodeType: 'standalone' as const,
      },
    }
  })

  const cols = Math.min(sessions.length, GRID_COLUMNS)
  const rows = Math.ceil(sessions.length / GRID_COLUMNS)
  const width = cols * GRID_NODE_GAP_X - 40
  const height = rows * GRID_NODE_GAP_Y - 40

  return { id: 'standalone', nodes, edges: [], width, height }
}

function positionGroups(groups: LayoutGroup[]): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = []
  const allEdges: Edge[] = []

  let maxWidth = 0
  for (const group of groups) {
    if (group.width > maxWidth) maxWidth = group.width
  }

  let yOffset = 0

  for (const group of groups) {
    if (group.nodes.length === 0) continue

    const xOffset = (maxWidth - group.width) / 2

    for (const node of group.nodes) {
      allNodes.push({
        ...node,
        position: {
          x: node.position.x + xOffset,
          y: node.position.y + yOffset,
        },
      })
    }

    allEdges.push(...group.edges)
    yOffset += group.height + GROUP_GAP
  }

  return { nodes: allNodes, edges: allEdges }
}

function buildDagNodeIndexBySessionId(dags: ApiDagGraph[]): Map<string, ApiDagNode> {
  const map = new Map<string, ApiDagNode>()
  for (const dag of dags) {
    for (const node of Object.values(dag.nodes)) {
      if (node.session) map.set(node.session.id, node)
    }
  }
  return map
}

function buildCrossGroupEdges(
  standalone: ApiSession[],
  dagNodeBySessionId: Map<string, ApiDagNode>,
  isDark: boolean,
): Edge[] {
  const edges: Edge[] = []
  for (const child of standalone) {
    if (!child.parentId) continue
    const parentDagNode = dagNodeBySessionId.get(child.parentId)
    if (!parentDagNode) continue

    const isCiFix = child.mode === 'ci-fix'
    const relationship: EdgeRelationship = isCiFix ? 'ci-fix' : 'parent-child'
    const parentRunning = parentDagNode.status === 'running'
    const parentCiPending = parentDagNode.status === 'ci-pending'
    const childRunning = child.status === 'running'
    const animated = childRunning || parentRunning || (isCiFix && parentCiPending)

    const color = isCiFix ? '#f97316' : (isDark ? '#a78bfa' : '#7c3aed')

    edges.push({
      id: `cross-${parentDagNode.id}-${child.id}`,
      source: parentDagNode.id,
      target: child.id,
      type: 'smoothstep',
      animated,
      style: {
        stroke: color,
        strokeDasharray: isCiFix ? '4 4' : '2 3',
        opacity: 0.7,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      data: { relationship },
    })
  }
  return edges
}

export function layoutUniverse(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
  isDark: boolean,
): { nodes: Node[]; edges: Edge[] } {
  if (sessions.length === 0 && dags.length === 0) {
    return { nodes: [], edges: [] }
  }

  const { parentChildRoots, shipRoots, shipMembers, standalone, sessionById } = classifySessions(
    sessions,
    dags,
  )

  const groups: LayoutGroup[] = []

  for (const dag of dags) {
    if (Object.keys(dag.nodes).length > 0) {
      groups.push(layoutDagGroup(dag, isDark))
    }
  }

  for (const root of shipRoots) {
    groups.push(layoutShipGroup(root, sessionById, shipMembers, isDark))
  }

  for (const root of parentChildRoots) {
    groups.push(layoutParentChildGroup(root, sessionById, isDark))
  }

  const standaloneGroup = layoutStandaloneGroup(standalone)
  if (standaloneGroup.nodes.length > 0) {
    groups.push(standaloneGroup)
  }

  const positioned = positionGroups(groups)

  const dagNodeBySessionId = buildDagNodeIndexBySessionId(dags)
  const crossGroupEdges = buildCrossGroupEdges(standalone, dagNodeBySessionId, isDark)

  return { nodes: positioned.nodes, edges: [...positioned.edges, ...crossGroupEdges] }
}
