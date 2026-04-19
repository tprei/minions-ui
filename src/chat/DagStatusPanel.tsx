import { useComputed, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { ApiDagGraph, ApiDagNode, ApiSession } from '../api/types'
import type { ConnectionStore } from '../state/types'

interface DagStatusPanelProps {
  session: ApiSession
  store: ConnectionStore
}

// Finds the DAG for an active session. Parent sessions own the DAG; the server
// keys `ApiDagGraph.rootTaskId` by the parent session's threadId as a string,
// and each child node embeds its own `ApiSession` via `node.session`.
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

export function DagStatusPanel({ session, store }: DagStatusPanelProps) {
  const collapsed = useSignal(false)

  const dag = useComputed(() => findDagForSession(store.dags.value, session))

  useEffect(() => {
    collapsed.value = false
  }, [session.id, collapsed])

  const graph = dag.value
  if (!graph) return null

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

  return (
    <div
      class={`border-b ${graphTone} bg-white dark:bg-slate-800 shrink-0`}
      data-testid="dag-status-panel"
    >
      <button
        type="button"
        onClick={() => { collapsed.value = !collapsed.value }}
        class="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50"
        data-testid="dag-status-panel-toggle"
        aria-expanded={!collapsed.value}
      >
        <span class="text-[10px] text-slate-500 dark:text-slate-400 w-3 inline-block shrink-0">
          {collapsed.value ? '▸' : '▾'}
        </span>
        <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
          DAG · {graph.id.replace(/^dag-/, '')}
        </span>
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
      {!collapsed.value && (
        <ul class="px-4 pb-3 pt-1 flex flex-col gap-1.5" data-testid="dag-status-node-list">
          {nodes.map((node) => (
            <DagNodeRow key={node.id} node={node} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DagNodeRow({ node }: { node: ApiDagNode }) {
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

  return (
    <li
      class={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs transition-colors ${tone}`}
      data-testid={`dag-status-node-${node.id}`}
      data-status={node.status}
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
