import { useMemo, useCallback, useRef, useEffect, useState } from 'preact/hooks'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
} from '@reactflow/core'
import type { Node } from '@reactflow/core'
import { Background } from '@reactflow/background'
import { Controls } from '@reactflow/controls'
import { MiniMap } from '@reactflow/minimap'
import '@reactflow/core/dist/style.css'
import '@reactflow/core/dist/base.css'
import '@reactflow/controls/dist/style.css'
import '@reactflow/minimap/dist/style.css'
import type { ApiSession, ApiDagGraph, FeedbackMetadata } from '../api/types'
import { StatusBadge, AttentionIconStack, getStatusColors, getAttentionBorder, formatRelativeTime } from './shared'
import { PrLink } from './PrLink'
import { ContextMenu, useLongPress, useContextMenu } from './ContextMenu'
import type { ContextMenuActions, DagContext } from './ContextMenu'
import { layoutUniverse, NODE_WIDTH, NODE_HEIGHT } from './universe-layout'
import type { UniverseEdge } from './universe-layout'

const NODE_FULL_WIDTH = NODE_WIDTH
const NODE_FULL_HEIGHT = NODE_HEIGHT
const NODE_WIDTH_HALF = NODE_WIDTH / 2
const NODE_HEIGHT_HALF = NODE_HEIGHT / 2
import { NodeDetailPopup } from './NodeDetailPopup'
import { useTheme } from '../hooks/useTheme'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useHaptics } from '../hooks/useHaptics'

function isFeedbackSession(session?: ApiSession): session is ApiSession & { metadata: FeedbackMetadata } {
  return session !== undefined &&
    session.metadata !== undefined &&
    typeof session.metadata === 'object' &&
    'kind' in session.metadata &&
    session.metadata.kind === 'feedback'
}

interface UniverseNodeData {
  session?: ApiSession
  label: string
  status: string
  groupId: string
  nodeType: 'dag' | 'parent-child' | 'standalone' | 'ship'
  isDark: boolean
  scale: number
  onContextMenu: (session: ApiSession, position: { x: number; y: number }) => void
  onNodeClick: (session: ApiSession) => void
  onRetryNode?: (session: ApiSession) => void
  onViewNodeLogs?: (sessionId: string) => void
}

function UniverseNodeComponent({ data }: { data: UniverseNodeData }) {
  const isDark = data.isDark
  const session = data.session
  const statusColors = getStatusColors(isDark)
  const status = data.status as keyof ReturnType<typeof getStatusColors>
  const colors = statusColors[status] || statusColors.pending
  const { vibrate } = useHaptics()

  const attentionRing = session ? getAttentionBorder(session, isDark) : ''

  const handleContextMenuOpen = useCallback(
    (position: { x: number; y: number }) => {
      if (session) {
        vibrate('medium')
        data.onContextMenu(session, position)
      }
    },
    [session, data, vibrate]
  )

  const longPressHandlers = useLongPress(handleContextMenuOpen, handleContextMenuOpen)

  const handleClick = useCallback(() => {
    if (session) {
      data.onNodeClick(session)
    }
  }, [session, data])

  const hasSession = Boolean(session)
  const isActive = session?.status === 'running' || session?.status === 'pending'
  const isRebasing = data.status === 'rebasing'
  const isCoordinator = data.nodeType === 'ship'

  const nodeTypeLabel = data.nodeType === 'dag' ? 'DAG' : data.nodeType === 'parent-child' ? 'Tree' : null
  const isFeedback = isFeedbackSession(session)

  const isFailed = data.status === 'failed' || data.status === 'ci-failed'
  const showFailureChips = isFailed && Boolean(session) && (Boolean(data.onRetryNode) || Boolean(data.onViewNodeLogs))

  const handleRetryClick = useCallback(
    (e: Event) => {
      e.stopPropagation()
      if (session && data.onRetryNode) {
        vibrate('light')
        data.onRetryNode(session)
      }
    },
    [session, data, vibrate]
  )

  const handleLogsClick = useCallback(
    (e: Event) => {
      e.stopPropagation()
      if (session && data.onViewNodeLogs) {
        vibrate('light')
        data.onViewNodeLogs(session.id)
      }
    },
    [session, data, vibrate]
  )

  const baseWidth = isCoordinator ? 300 : 240
  const baseHeight = isCoordinator ? (showFailureChips ? 152 : 120) : (showFailureChips ? 132 : 100)
  const nodeWidth = Math.round(baseWidth * data.scale)
  const nodeHeight = Math.round(baseHeight * data.scale)

  return (
    <div
      onTouchStart={longPressHandlers.onTouchStart}
      onTouchEnd={longPressHandlers.onTouchEnd}
      onTouchMove={longPressHandlers.onTouchMove}
      onContextMenu={longPressHandlers.onContextMenu}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        onClick={hasSession ? handleClick : undefined}
        role={hasSession ? 'button' : undefined}
        tabIndex={hasSession ? 0 : undefined}
        class={`${attentionRing}`}
        data-testid={`universe-node-${session?.id || data.label}`}
        style={{
          width: nodeWidth,
          height: nodeHeight,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          color: colors.text,
          borderWidth: '2px',
          borderStyle: 'solid',
          borderRadius: '10px',
          padding: '10px 12px',
          cursor: hasSession ? 'pointer' : 'default',
          boxShadow: isActive
            ? `0 0 12px ${colors.border}40`
            : '0 1px 3px rgba(0,0,0,0.1)',
          transition: 'box-shadow 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <div class="flex items-center justify-between gap-1">
          <div class="font-semibold text-sm truncate flex-1">{data.label}</div>
          <div class="flex items-center gap-1 shrink-0">
            {isFeedback && (
              <span
                class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isDark ? 'rgba(251,191,36,0.2)' : 'rgba(245,158,11,0.15)',
                  color: isDark ? '#fbbf24' : '#d97706',
                }}
                data-testid="feedback-canvas-badge"
              >
                Feedback
              </span>
            )}
            {nodeTypeLabel && (
              <span
                class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                  color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
                }}
              >
                {nodeTypeLabel}
              </span>
            )}
          </div>
        </div>

        <div class="flex items-center gap-2 mt-1">
          {isRebasing && (
            <span class="inline-flex items-center gap-1.5 text-xs" data-testid="rebasing-indicator">
              <span
                class="inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin"
                style={{ color: colors.border }}
              />
            </span>
          )}
          <StatusBadge status={status} />
          {session?.needsAttention && session.attentionReasons.length > 0 && (
            <AttentionIconStack reasons={session.attentionReasons} darkMode={isDark} />
          )}
        </div>

        {isCoordinator && session?.stage && (
          <div class="mt-1">
            <span
              class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: isDark ? 'rgba(167,139,250,0.2)' : 'rgba(124,58,237,0.1)',
                color: isDark ? '#a78bfa' : '#7c3aed',
              }}
            >
              stage: {session.stage}
            </span>
          </div>
        )}

        <div class="flex items-center justify-between mt-1">
          {session?.prUrl ? (
            <div onClick={(e: Event) => e.stopPropagation()}>
              <PrLink prUrl={session.prUrl} compact />
            </div>
          ) : session?.branch ? (
            <div class="text-[11px] truncate opacity-60 max-w-[140px]">{session.branch}</div>
          ) : session?.command ? (
            <div class="text-[11px] truncate opacity-60 max-w-[140px]">{session.command}</div>
          ) : (
            <div />
          )}
          {session?.updatedAt && (
            <span class="text-[10px] opacity-40 shrink-0">{formatRelativeTime(session.updatedAt)}</span>
          )}
        </div>

        {showFailureChips && (
          <div class="flex items-center gap-1.5 mt-1.5" data-testid={`failure-chips-${session!.id}`}>
            {data.onRetryNode && (
              <button
                type="button"
                onClick={handleRetryClick}
                class="inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-1 border transition-colors"
                style={{
                  backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : '#fff',
                  borderColor: colors.border,
                  color: colors.border,
                }}
                title="Retry this node"
                data-testid={`node-retry-chip-${session!.id}`}
              >
                <span aria-hidden="true">↻</span>
                <span>Retry</span>
              </button>
            )}
            {data.onViewNodeLogs && (
              <button
                type="button"
                onClick={handleLogsClick}
                class="inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-1 border transition-colors"
                style={{
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
                  borderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                  color: isDark ? '#e5e7eb' : '#374151',
                }}
                title="View logs for this node"
                data-testid={`node-logs-chip-${session!.id}`}
              >
                <span aria-hidden="true">📋</span>
                <span>Logs</span>
              </button>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = {
  universeNode: UniverseNodeComponent,
}

interface FitToScreenFABProps {
  onClick: () => void
  isDark: boolean
}

function FitToScreenFAB({ onClick, isDark }: FitToScreenFABProps) {
  const { vibrate } = useHaptics()

  const handleClick = useCallback(() => {
    vibrate('light')
    onClick()
  }, [onClick, vibrate])

  return (
    <button
      onClick={handleClick}
      data-testid="fit-to-screen-fab"
      aria-label="Fit to screen"
      style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        backgroundColor: isDark ? '#4b5563' : '#ffffff',
        color: isDark ? '#ffffff' : '#1f2937',
        border: isDark ? '1px solid #6b7280' : '1px solid #d1d5db',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseDown={(e) => {
        const target = e.currentTarget
        target.style.transform = 'scale(0.95)'
      }}
      onMouseUp={(e) => {
        const target = e.currentTarget
        target.style.transform = 'scale(1)'
      }}
      onMouseLeave={(e) => {
        const target = e.currentTarget
        target.style.transform = 'scale(1)'
      }}
      onTouchStart={(e) => {
        const target = e.currentTarget
        target.style.transform = 'scale(0.95)'
      }}
      onTouchEnd={(e) => {
        const target = e.currentTarget
        target.style.transform = 'scale(1)'
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    </button>
  )
}

function getResponsiveNodeScale(isMobile: boolean, isTablet: boolean): number {
  if (isMobile) return 0.85
  if (isTablet) return 0.92
  return 1
}

export interface UniverseCanvasProps {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  isLoading?: boolean
  onSendReply: (sessionId: string, message: string) => Promise<void>
  onStopMinion: (sessionId: string) => Promise<void>
  onCloseSession: (sessionId: string) => Promise<void>
  onOpenThread: (session: ApiSession) => void
  isActionLoading: boolean
  onNodeSelect?: (session: ApiSession) => void
  onOpenChat?: (sessionId: string) => void
  onViewLogs?: (sessionId: string) => void
  onRetryRebase?: (dagId: string, nodeId: string) => Promise<void>
  accentColor?: string
  viewportStorageKey?: string
}

interface PersistedViewport {
  x: number
  y: number
  zoom: number
}

export function loadPersistedViewport(storageKey: string): PersistedViewport | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.zoom === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y) &&
      Number.isFinite(parsed.zoom) &&
      parsed.zoom > 0
    ) {
      return { x: parsed.x, y: parsed.y, zoom: parsed.zoom }
    }
  } catch {
    return null
  }
  return null
}

export function savePersistedViewport(storageKey: string, viewport: PersistedViewport): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(viewport))
  } catch {
    return
  }
}

export function UniverseCanvas(props: UniverseCanvasProps) {
  return (
    <ReactFlowProvider>
      <UniverseCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function UniverseCanvasInner({
  sessions,
  dags,
  isLoading = false,
  onSendReply,
  onStopMinion,
  onCloseSession,
  onOpenThread,
  isActionLoading,
  onNodeSelect,
  onOpenChat,
  onViewLogs,
  onRetryRebase,
  viewportStorageKey,
}: UniverseCanvasProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const contextMenu = useContextMenu()
  const [detailSession, setDetailSession] = useState<ApiSession | null>(null)
  const prevLayoutRef = useRef<{ nodes: Node[]; edges: UniverseEdge[] } | null>(null)
  const reactFlow = useReactFlow()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const isTablet = useMediaQuery('(min-width: 641px) and (max-width: 1024px)')
  const nodeScale = getResponsiveNodeScale(isMobile.value, isTablet.value)

  const dagBySessionId = useMemo(() => {
    const map = new Map<string, { dagId: string; nodeStatus: string }>()
    for (const dag of dags) {
      for (const node of Object.values(dag.nodes)) {
        if (node.session) {
          map.set(node.session.id, { dagId: dag.id, nodeStatus: node.status })
        } else {
          map.set(node.id, { dagId: dag.id, nodeStatus: node.status })
        }
      }
    }
    return map
  }, [dags])

  useEffect(() => {
    if (detailSession) {
      const updated = sessions.find((s) => s.id === detailSession.id)
      if (updated && updated !== detailSession) {
        setDetailSession(updated)
      }
    }
  }, [sessions, detailSession])

  const handleNodeContextMenu = useCallback(
    (session: ApiSession, position: { x: number; y: number }) => {
      contextMenu.open(session, position)
    },
    [contextMenu]
  )

  const handleNodeClick = useCallback((session: ApiSession) => {
    setDetailSession(session)
    onNodeSelect?.(session)
  }, [onNodeSelect])

  const handleRetryNode = useCallback((session: ApiSession) => {
    void onSendReply(session.id, '/retry')
  }, [onSendReply])

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (sessions.length === 0 && dags.length === 0) {
      return { nodes: [] as Node[], edges: [] as UniverseEdge[] }
    }
    const result = layoutUniverse(sessions, dags, isDark)
    return result as { nodes: Node[]; edges: UniverseEdge[] }
  }, [sessions, dags, isDark])

  const nodesWithHandlers = useMemo(() => {
    return layoutNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isDark,
        scale: nodeScale,
        onContextMenu: handleNodeContextMenu,
        onNodeClick: handleNodeClick,
        onRetryNode: handleRetryNode,
        onViewNodeLogs: onViewLogs,
      },
    }))
  }, [layoutNodes, isDark, nodeScale, handleNodeContextMenu, handleNodeClick, handleRetryNode, onViewLogs])

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithHandlers)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  const layoutKey = useMemo(() => {
    return JSON.stringify(sessions.map((s) => `${s.id}:${s.status}:${s.needsAttention}`)) +
      JSON.stringify(dags.map((d) => `${d.id}:${d.status}`))
  }, [sessions, dags])

  useEffect(() => {
    const currentKey = JSON.stringify(nodesWithHandlers.map((n) => n.id)) +
      JSON.stringify(layoutEdges.map((e) => e.id))
    const prevKey = prevLayoutRef.current
      ? JSON.stringify(prevLayoutRef.current.nodes.map((n) => n.id)) +
        JSON.stringify(prevLayoutRef.current.edges.map((e) => e.id))
      : null

    if (currentKey !== prevKey) {
      setNodes(nodesWithHandlers)
      setEdges(layoutEdges)
      prevLayoutRef.current = { nodes: nodesWithHandlers, edges: layoutEdges }
    }
  }, [layoutKey, nodesWithHandlers, layoutEdges, setNodes, setEdges])

  const handleOpenParent = useCallback(
    (parentId: string) => {
      const parent = sessions.find((s) => s.id === parentId)
      if (parent) {
        setDetailSession(parent)
        onNodeSelect?.(parent)
      }
      const layoutNode = layoutNodes.find((n) => n.id === parentId)
      if (layoutNode) {
        const cx = layoutNode.position.x + NODE_WIDTH_HALF
        const cy = layoutNode.position.y + NODE_HEIGHT_HALF
        reactFlow.setCenter(cx, cy, { zoom: 1, duration: 400 })
      }
    },
    [sessions, onNodeSelect, layoutNodes, reactFlow]
  )

  const handleViewInDag = useCallback(
    (dagId: string, _sessionId: string) => {
      const dagNodes = layoutNodes.filter((n) => {
        const data = n.data as { groupId?: string } | undefined
        return data?.groupId === `dag-${dagId}`
      })
      if (dagNodes.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of dagNodes) {
        const nodeMaxX = node.position.x + NODE_FULL_WIDTH
        const nodeMaxY = node.position.y + NODE_FULL_HEIGHT
        if (node.position.x < minX) minX = node.position.x
        if (node.position.y < minY) minY = node.position.y
        if (nodeMaxX > maxX) maxX = nodeMaxX
        if (nodeMaxY > maxY) maxY = nodeMaxY
      }
      reactFlow.fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.2, duration: 400 })
    },
    [layoutNodes, reactFlow]
  )

  const contextMenuActions: ContextMenuActions = useMemo(
    () => ({
      onSendReply,
      onStopMinion,
      onCloseSession,
      onOpenThread,
      onOpenParent: handleOpenParent,
      onViewInDag: handleViewInDag,
      isActionLoading,
    }),
    [onSendReply, onStopMinion, onCloseSession, onOpenThread, handleOpenParent, handleViewInDag, isActionLoading]
  )

  const activeDagContext: DagContext | null = contextMenu.state.session
    ? dagBySessionId.get(contextMenu.state.session.id) ?? null
    : null

  const statusColors = getStatusColors(isDark)

  const hintColor = isDark ? 'text-gray-400' : 'text-gray-500'

  if (sessions.length === 0 && dags.length === 0 && !isLoading) {
    return (
      <div class={`flex items-center justify-center h-[60vh] ${hintColor}`}>
        <div class="text-center">
          <div class="text-4xl mb-3 opacity-40">~</div>
          <div class="text-lg font-medium">No active sessions</div>
          <div class="text-sm mt-1 opacity-70">
            Launch a task from the bar above to get started
          </div>
        </div>
      </div>
    )
  }

  if (isLoading && sessions.length === 0 && dags.length === 0) {
    return (
      <div class={`flex items-center justify-center h-[60vh] ${hintColor}`}>
        <div class="animate-pulse text-lg">Loading universe...</div>
      </div>
    )
  }

  const handleFitToScreen = useCallback(() => {
    reactFlow.fitView({ padding: 0.2, duration: 400 })
  }, [reactFlow])

  const persistedViewport = useMemo(
    () => (viewportStorageKey ? loadPersistedViewport(viewportStorageKey) : null),
    [viewportStorageKey]
  )
  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: PersistedViewport) => {
      if (!viewportStorageKey || !viewport) return
      savePersistedViewport(viewportStorageKey, viewport)
    },
    [viewportStorageKey]
  )

  const minZoom = isMobile.value ? 0.15 : 0.1
  const maxZoom = isMobile.value ? 1.5 : 2

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 120px)', position: 'relative' }} data-testid="universe-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveEnd={handleMoveEnd}
        nodeTypes={nodeTypes}
        defaultViewport={persistedViewport ?? undefined}
        fitView={!persistedViewport}
        fitViewOptions={{ padding: 0.3 }}
        minZoom={minZoom}
        maxZoom={maxZoom}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <Background gap={20} size={1} color={isDark ? '#1f2937' : '#f3f4f6'} />
        <Controls
          showInteractive={false}
          style={{ filter: isDark ? 'invert(1)' : undefined }}
        />
        <MiniMap
          nodeColor={(node: Node) => {
            const nodeStatus = node.data?.status as string | undefined
            if (nodeStatus && statusColors[nodeStatus as keyof typeof statusColors]) {
              return statusColors[nodeStatus as keyof typeof statusColors].border
            }
            return '#6b7280'
          }}
          maskColor={isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'}
          style={{ filter: isDark ? 'invert(0.8) hue-rotate(180deg)' : undefined }}
        />
      </ReactFlow>

      <FitToScreenFAB onClick={handleFitToScreen} isDark={isDark} />

      {contextMenu.state.session && contextMenu.state.position && (
        <ContextMenu
          session={contextMenu.state.session}
          position={contextMenu.state.position}
          actions={contextMenuActions}
          onClose={contextMenu.close}
          dagContext={activeDagContext}
        />
      )}

      {detailSession && (
        <NodeDetailPopup
          session={detailSession}
          onClose={() => setDetailSession(null)}
          onOpenChat={onOpenChat}
          onViewLogs={onViewLogs}
          sessions={sessions}
          dags={dags}
          onSelectSession={(s) => setDetailSession(s)}
          onRetryRebase={onRetryRebase}
        />
      )}
    </div>
  )
}
