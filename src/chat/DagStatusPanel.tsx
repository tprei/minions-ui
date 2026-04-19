import { useComputed, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { ApiDagGraph, ApiDagNode, ApiSession } from '../api/types'
import type { ConnectionStore } from '../state/types'

interface DagStatusPanelProps {
  session: ApiSession
  store: ConnectionStore
  onSelect?: (sessionId: string) => void
}

// Finds the DAG for an active session. Either the active session IS the DAG
// parent (match via threadId → `ApiDagGraph.rootTaskId`) or one of the DAG's
// child nodes wraps this session (match via `node.session.id`).
function findDagForSession(dags: ApiDagGraph[], session: ApiSession): ApiDagGraph | null {
  if (session.threadId !== undefined) {
    const tidStr = String(session.threadId)
    for (const g of dags) {
      if (g.rootTaskId === tidStr) return g
    }
  }
  for (const g of dags) {
    for (const n of Object.values(g.nodes)) {
      if (n.session?.id === session.id) return g
    }
  }
  return null
}

function findParentSession(sessions: ApiSession[], dag: ApiDagGraph): ApiSession | null {
  for (const s of sessions) {
    if (s.threadId !== undefined && String(s.threadId) === dag.rootTaskId) return s
  }
  return null
}

// Returns the PR URL from the earliest node in topological order that has one.
// Nodes without dependencies come first (stack/DAG base), then nodes whose
// dependencies are already covered. `Object.values(graph.nodes)` iteration
// order already follows insertion order, which the server emits topologically,
// so a light dependency check is enough to skip isolated mid-chain entries.
function firstNodePrUrl(nodes: ApiDagNode[]): string | undefined {
  const covered = new Set<string>()
  for (const n of nodes) {
    const ready = n.dependencies.every((d) => covered.has(d))
    if (ready && n.session?.prUrl) return n.session.prUrl
    covered.add(n.id)
  }
  for (const n of nodes) {
    if (n.session?.prUrl) return n.session.prUrl
  }
  return undefined
}

const DAG_NODE_COLORS: Record<ApiDagNode['status'], string> = {
  pending: 'bg-slate-300 dark:bg-slate-600',
  running: 'bg-blue-500 animate-pulse',
  'ci-pending': 'bg-amber-400 animate-pulse',
  'ci-failed': 'bg-red-500',
  completed: 'bg-green-500',
  landed: 'bg-emerald-600',
  failed: 'bg-red-500',
  skipped: 'bg-slate-400',
}

const DAG_NODE_LABELS: Record<ApiDagNode['status'], string> = {
  pending: 'pending',
  running: 'running',
  'ci-pending': 'CI',
  'ci-failed': 'CI failed',
  completed: 'done',
  landed: 'landed',
  failed: 'failed',
  skipped: 'skipped',
}

export function DagStatusPanel({ session, store, onSelect }: DagStatusPanelProps) {
  const collapsed = useSignal(false)

  const dag = useComputed(() => findDagForSession(store.dags.value, session))
  const parentSession = useComputed(() => {
    const g = dag.value
    return g ? findParentSession(store.sessions.value, g) : null
  })

  useEffect(() => {
    collapsed.value = false
  }, [session.id, collapsed])

  const graph = dag.value
  if (!graph) return null

  const parent = parentSession.value
  const isViewingParent = !!parent && parent.id === session.id

  const nodes = Object.values(graph.nodes)
  const done = nodes.filter((n) => n.status === 'completed' || n.status === 'landed').length
  const running = nodes.filter((n) => n.status === 'running' || n.status === 'ci-pending').length
  const failed = nodes.filter((n) => n.status === 'failed' || n.status === 'ci-failed').length
  const total = nodes.length

  const graphTone =
    graph.status === 'failed'
      ? 'border-red-300 dark:border-red-800'
      : graph.status === 'completed'
        ? 'border-emerald-300 dark:border-emerald-800'
        : 'border-slate-200 dark:border-slate-700'

  const parentClickable = !!parent && !!onSelect && !isViewingParent
  const parentLabel = parent ? parent.slug || parent.id : `dag-${graph.id.replace(/^dag-/, '')}`

  // Parent orchestrators (`/plan`, `/dag`) usually don't own a PR — each
  // child does. Fall back to the first node's PR (topological base of the
  // stack/DAG) so users can always jump to a representative PR from the
  // panel header.
  const headerPrUrl = parent?.prUrl ?? firstNodePrUrl(nodes)
  const headerPrLabel = parent?.prUrl ? 'Parent PR' : 'First PR'

  return (
    <div
      class={`border-b ${graphTone} bg-white dark:bg-slate-800 shrink-0`}
      data-testid="dag-status-panel"
    >
      <div class="flex items-stretch">
        <button
          type="button"
          onClick={() => { collapsed.value = !collapsed.value }}
          class="flex items-center justify-center px-3 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50"
          data-testid="dag-status-panel-toggle"
          aria-expanded={!collapsed.value}
          aria-label={collapsed.value ? 'Expand DAG' : 'Collapse DAG'}
        >
          <span class="text-[10px] w-3 inline-block">
            {collapsed.value ? '▸' : '▾'}
          </span>
        </button>
        <button
          type="button"
          disabled={!parentClickable}
          onClick={() => {
            if (parentClickable && onSelect && parent) onSelect(parent.id)
          }}
          class={`flex-1 min-w-0 flex items-center gap-2 py-2 text-left ${
            parentClickable
              ? 'hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer'
              : 'cursor-default'
          }`}
          data-testid="dag-status-parent-btn"
          title={parentClickable ? 'Open parent session' : undefined}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${
              graph.status === 'failed'
                ? 'bg-red-500'
                : graph.status === 'completed'
                  ? 'bg-emerald-500'
                  : 'bg-blue-500 animate-pulse'
            }`}
            aria-hidden="true"
          />
          <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {parentLabel}
          </span>
          <span class="text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400 shrink-0">
            parent
          </span>
          {isViewingParent && (
            <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 shrink-0">
              · current
            </span>
          )}
          <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap ml-auto">
            <span class="text-green-600 dark:text-green-400">{done}</span>
            <span class="text-slate-400 dark:text-slate-500"> / </span>
            <span>{total}</span>
            {running > 0 && (
              <>
                <span class="text-slate-400 dark:text-slate-500"> · </span>
                <span class="text-blue-600 dark:text-blue-400">{running} running</span>
              </>
            )}
            {failed > 0 && (
              <>
                <span class="text-slate-400 dark:text-slate-500"> · </span>
                <span class="text-red-600 dark:text-red-400">{failed} failed</span>
              </>
            )}
          </span>
        </button>
        {headerPrUrl && (
          <a
            href={headerPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 px-3 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
            data-testid="dag-status-parent-pr"
            title={`Open ${headerPrLabel.toLowerCase()} on GitHub`}
          >
            <span class="hidden sm:inline">{headerPrLabel}</span>
            <span class="sm:hidden">PR</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      {!collapsed.value && (
        <ul class="px-4 pb-3 pt-1 flex flex-col gap-1.5" data-testid="dag-status-node-list">
          {nodes.map((node) => (
            <DagNodeRow
              key={node.id}
              node={node}
              isActive={!!node.session && node.session.id === session.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function DagNodeRow({
  node,
  isActive,
  onSelect,
}: {
  node: ApiDagNode
  isActive: boolean
  onSelect?: (sessionId: string) => void
}) {
  const dot = DAG_NODE_COLORS[node.status]
  const label = DAG_NODE_LABELS[node.status]
  const sess = node.session
  const prUrl = sess?.prUrl
  const deps = node.dependencies
  const tone =
    node.status === 'failed' || node.status === 'ci-failed'
      ? 'bg-red-50/60 dark:bg-red-950/30'
      : node.status === 'completed' || node.status === 'landed'
        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
        : node.status === 'running' || node.status === 'ci-pending'
          ? 'bg-blue-50/40 dark:bg-blue-950/20'
          : 'bg-slate-50 dark:bg-slate-900/40'

  const clickable = !!sess && !!onSelect
  const handleClick = () => {
    if (!clickable) return
    onSelect!(sess!.id)
  }

  const activeRing = isActive ? 'ring-2 ring-indigo-400/60 dark:ring-indigo-500/50' : 'border border-slate-200 dark:border-slate-700'
  const clickableClass = clickable
    ? 'cursor-pointer hover:bg-white dark:hover:bg-slate-800/80 active:scale-[.99]'
    : ''

  return (
    <li
      class={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all ${tone} ${activeRing} ${clickableClass}`}
      data-testid={`dag-status-node-${node.id}`}
      data-status={node.status}
      data-active={isActive ? 'true' : undefined}
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      } : undefined}
    >
      <span class={`inline-block h-2 w-2 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
      <span class="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
        {node.slug || node.id}
      </span>
      <span class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
        {label}
      </span>
      {deps.length > 0 && (
        <span class="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 truncate">
          ← {deps.join(', ')}
        </span>
      )}
      {prUrl && (
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          PR ↗
        </a>
      )}
    </li>
  )
}
