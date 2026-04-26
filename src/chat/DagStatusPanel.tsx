import { useComputed, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { ApiDagGraph, ApiDagNode, ApiSession } from '../api/types'
import type { ConnectionStore } from '../state/types'
import { useMediaQuery } from '../hooks/useMediaQuery'

const COLLAPSE_STORAGE_KEY = 'dag-panel-collapsed'

function readInitialCollapsed(isDesktop: boolean): boolean {
  if (typeof localStorage === 'undefined') return !isDesktop
  const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return !isDesktop
}

interface DagStatusPanelProps {
  session: ApiSession
  store: ConnectionStore
  onSelect?: (sessionId: string) => void
  onLand?: (dagId: string, nodeId: string) => Promise<void>
}

// Finds the DAG for an active session. Either the active session IS the DAG
// root (match via session.id → `ApiDagGraph.rootTaskId`) or one of the DAG's
// child nodes wraps this session (match via `node.session.id`).
function findDagForSession(dags: ApiDagGraph[], session: ApiSession): ApiDagGraph | null {
  for (const g of dags) {
    if (g.rootTaskId === session.id) return g
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
    if (s.id === dag.rootTaskId) return s
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
  rebasing: 'bg-indigo-500 animate-pulse',
  'rebase-conflict': 'bg-amber-500',
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
  rebasing: 'rebasing',
  'rebase-conflict': 'conflict',
}

export function DagStatusPanel({ session, store, onSelect, onLand }: DagStatusPanelProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const collapsed = useSignal(readInitialCollapsed(isDesktop.value))

  const dag = useComputed(() => findDagForSession(store.dags.value, session))
  const parentSession = useComputed(() => {
    const g = dag.value
    return g ? findParentSession(store.sessions.value, g) : null
  })

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed.value))
  }, [collapsed.value])

  const graph = dag.value
  if (!graph) return null

  const parent = parentSession.value
  const isViewingParent = !!parent && parent.id === session.id

  const nodes = Object.values(graph.nodes).sort((a, b) => {
    const aNum = parseInt(a.id.match(/\d+$/)?.[0] ?? '0', 10)
    const bNum = parseInt(b.id.match(/\d+$/)?.[0] ?? '0', 10)
    return aNum - bNum
  })
  const done = nodes.filter((n) => n.status === 'completed' || n.status === 'landed').length
  const running = nodes.filter((n) => n.status === 'running' || n.status === 'ci-pending').length
  const failed = nodes.filter((n) => n.status === 'failed' || n.status === 'ci-failed').length
  const total = nodes.length
  const progress = total === 0 ? 0 : Math.round((done / total) * 100)

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
  const progressTone = failed > 0
    ? 'bg-red-500'
    : graph.status === 'completed'
      ? 'bg-emerald-500'
      : 'bg-blue-500'

  return (
    <div
      class={`border-b ${graphTone} bg-white dark:bg-slate-800 shrink-0 max-h-48 md:max-h-none overflow-y-auto`}
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
      <div
        class="h-1 bg-slate-100 dark:bg-slate-900"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        data-testid="dag-status-progress"
      >
        <div
          class={`h-full transition-all duration-300 ${progressTone}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {!collapsed.value && (
        <ul class="px-4 pb-3 pt-1 flex flex-col gap-1.5" data-testid="dag-status-node-list">
          {nodes.map((node) => (
            <DagNodeRow
              key={node.id}
              node={node}
              dagId={graph.id}
              isActive={!!node.session && node.session.id === session.id}
              onSelect={onSelect}
              onLand={onLand}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function DagNodeRow({
  node,
  dagId,
  isActive,
  onSelect,
  onLand,
}: {
  node: ApiDagNode
  dagId: string
  isActive: boolean
  onSelect?: (sessionId: string) => void
  onLand?: (dagId: string, nodeId: string) => Promise<void>
}) {
  const landing = useSignal(false)
  const dot = DAG_NODE_COLORS[node.status]
  const label = DAG_NODE_LABELS[node.status]
  const sess = node.session
  const prUrl = sess?.prUrl
  const deps = node.dependencies
  const canLand = !!onLand && node.status === 'completed' && !!prUrl
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
      {canLand && (
        <button
          type="button"
          disabled={landing.value}
          onClick={async (e) => {
            e.stopPropagation()
            if (landing.value) return
            landing.value = true
            try {
              await onLand!(dagId, node.id)
            } finally {
              landing.value = false
            }
          }}
          class="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          data-testid={`dag-status-land-${node.id}`}
          title="Merge this node's PR"
        >
          {landing.value ? 'Landing…' : 'Land'}
        </button>
      )}
      {node.status === 'landed' && (
        <span class="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
          landed
        </span>
      )}
    </li>
  )
}
