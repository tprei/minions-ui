import dagre from 'dagre'
import type { Node, Edge } from '@reactflow/core'
import { MarkerType } from '@reactflow/core'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../api/types'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 100
const GROUP_GAP = 120
const GRID_COLUMNS = 3
const GRID_NODE_GAP_X = NODE_WIDTH + 40
const GRID_NODE_GAP_Y = NODE_HEIGHT + 40

export type EdgeRelationship = 'dag-dependency' | 'parent-child' | 'ci-fix'

export type UniverseNode = Node<{
  session?: ApiSession
  dagNode?: ApiDagNode
  label: string
  status: string
  groupId: string
  nodeType: 'dag' | 'parent-child' | 'standalone'
}>

export type UniverseEdge = Edge<{
  relationship: EdgeRelationship
}>

interface LayoutGroup {
  id: string
  nodes: Node[]
  edges: Edge[]
  width: number
  height: number
}

function classifySessions(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
): { dagOwned: Set<string>; parentChildRoots: ApiSession[]; standalone: ApiSession[] } {
  const dagOwned = new Set<string>()

  for (const dag of dags) {
    for (const node of Object.values(dag.nodes)) {
      if (node.session) {
        dagOwned.add(node.session.id)
      }
    }
  }

  const sessionById = new Map<string, ApiSession>()
  for (const s of sessions) {
    sessionById.set(s.id, s)
  }

  const inParentChildTree = new Set<string>()
  const parentChildRoots: ApiSession[] = []

  for (const s of sessions) {
    if (dagOwned.has(s.id)) continue
    if (inParentChildTree.has(s.id)) continue

    if (s.childIds.length > 0 && !s.parentId) {
      parentChildRoots.push(s)
      inParentChildTree.add(s.id)
      collectChildren(s, sessionById, inParentChildTree)
    }
  }

  const standalone: ApiSession[] = []
  for (const s of sessions) {
    if (!dagOwned.has(s.id) && !inParentChildTree.has(s.id)) {
      if (s.parentId && sessionById.has(s.parentId)) {
        const parent = sessionById.get(s.parentId)!
        if (parent.childIds.includes(s.id) && !dagOwned.has(parent.id)) {
          let root = parent
          while (root.parentId && sessionById.has(root.parentId) && !dagOwned.has(root.parentId)) {
            root = sessionById.get(root.parentId)!
          }
          if (!inParentChildTree.has(root.id)) {
            parentChildRoots.push(root)
            inParentChildTree.add(root.id)
            collectChildren(root, sessionById, inParentChildTree)
          }
          inParentChildTree.add(s.id)
          continue
        }
      }
      standalone.push(s)
    }
  }

  return { dagOwned, parentChildRoots, standalone }
}

function collectChildren(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  collected: Set<string>,
): void {
  for (const childId of session.childIds) {
    if (collected.has(childId)) continue
    collected.add(childId)
    const child = sessionById.get(childId)
    if (child) {
      collectChildren(child, sessionById, collected)
    }
  }
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
      edges.push({
        id: `dag-${dag.id}-${depId}-${node.id}`,
        source: depId,
        target: node.id,
        type: 'smoothstep',
        animated: node.status === 'running',
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

      edges.push({
        id: `pc-${session.id}-${childId}`,
        source: session.id,
        target: childId,
        type: 'smoothstep',
        animated: child.status === 'running',
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

export function layoutUniverse(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
  isDark: boolean,
): { nodes: Node[]; edges: Edge[] } {
  if (sessions.length === 0 && dags.length === 0) {
    return { nodes: [], edges: [] }
  }

  const sessionById = new Map<string, ApiSession>()
  for (const s of sessions) {
    sessionById.set(s.id, s)
  }

  const { parentChildRoots, standalone } = classifySessions(sessions, dags)

  const groups: LayoutGroup[] = []

  for (const dag of dags) {
    if (Object.keys(dag.nodes).length > 0) {
      groups.push(layoutDagGroup(dag, isDark))
    }
  }

  for (const root of parentChildRoots) {
    groups.push(layoutParentChildGroup(root, sessionById, isDark))
  }

  const standaloneGroup = layoutStandaloneGroup(standalone)
  if (standaloneGroup.nodes.length > 0) {
    groups.push(standaloneGroup)
  }

  return positionGroups(groups)
}
