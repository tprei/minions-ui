import { useMemo } from 'preact/hooks'
import type { ApiDagNode } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { StatusBadge, formatRelativeTime } from './shared'
import { PrLink } from './PrLink'
import {
  SHIP_COLUMN_LABELS,
  SHIP_COLUMN_ORDER,
  selectShipPipelines,
  type ShipColumn,
  type ShipPipelineSummary,
} from './ship-pipeline'
import type { ApiDagGraph } from '../api/types'

export interface ShipPipelineViewProps {
  dags: ApiDagGraph[]
  onOpenChat?: (sessionId: string) => void
}

const COLUMN_ACCENTS: Record<ShipColumn, { light: string; dark: string; label: string }> = {
  running: { light: 'border-blue-300 bg-blue-50', dark: 'border-blue-700 bg-blue-950/30', label: 'text-blue-700 dark:text-blue-300' },
  review: { light: 'border-indigo-300 bg-indigo-50', dark: 'border-indigo-700 bg-indigo-950/30', label: 'text-indigo-700 dark:text-indigo-300' },
  ci: { light: 'border-amber-300 bg-amber-50', dark: 'border-amber-700 bg-amber-950/30', label: 'text-amber-700 dark:text-amber-300' },
  landed: { light: 'border-emerald-300 bg-emerald-50', dark: 'border-emerald-700 bg-emerald-950/30', label: 'text-emerald-700 dark:text-emerald-300' },
}

function NodeCard({
  node,
  onOpenChat,
}: {
  node: ApiDagNode
  onOpenChat?: (sessionId: string) => void
}) {
  const session = node.session
  const clickable = Boolean(session && onOpenChat)

  const handleClick = () => {
    if (session && onOpenChat) onOpenChat(session.id)
  }

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClick()
              }
            }
          : undefined
      }
      class={`flex flex-col gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-left shadow-sm transition-colors ${
        clickable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60' : 'cursor-default'
      }`}
      data-testid={`ship-pipeline-card-${node.id}`}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
          {node.slug}
        </span>
        <StatusBadge status={node.status} />
      </div>
      <div class="flex items-center justify-between gap-2">
        {session?.prUrl ? (
          <div onClick={(e: Event) => e.stopPropagation()}>
            <PrLink prUrl={session.prUrl} compact />
          </div>
        ) : session?.branch ? (
          <span class="text-[11px] font-mono truncate text-slate-500 dark:text-slate-400 max-w-[180px]">
            {session.branch}
          </span>
        ) : (
          <span class="text-[11px] text-slate-400 dark:text-slate-500 italic">—</span>
        )}
        {session?.updatedAt && (
          <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
            {formatRelativeTime(session.updatedAt)}
          </span>
        )}
      </div>
    </div>
  )
}

function Column({
  column,
  nodes,
  isDark,
  onOpenChat,
}: {
  column: ShipColumn
  nodes: ApiDagNode[]
  isDark: boolean
  onOpenChat?: (sessionId: string) => void
}) {
  const accent = COLUMN_ACCENTS[column]
  const bg = isDark ? accent.dark : accent.light
  return (
    <div
      class={`flex flex-col gap-2 rounded-lg border ${bg} p-2 min-w-[220px] flex-1`}
      data-testid={`ship-pipeline-column-${column}`}
    >
      <div class="flex items-center justify-between px-1">
        <span class={`text-xs font-semibold uppercase tracking-wide ${accent.label}`}>
          {SHIP_COLUMN_LABELS[column]}
        </span>
        <span class="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {nodes.length}
        </span>
      </div>
      <div class="flex flex-col gap-1.5">
        {nodes.length === 0 ? (
          <div class="text-[11px] italic text-slate-400 dark:text-slate-500 px-1 py-2">
            Empty
          </div>
        ) : (
          nodes.map((node) => (
            <NodeCard key={node.id} node={node} onOpenChat={onOpenChat} />
          ))
        )}
      </div>
    </div>
  )
}

function PipelineBoard({
  summary,
  isDark,
  onOpenChat,
}: {
  summary: ShipPipelineSummary
  isDark: boolean
  onOpenChat?: (sessionId: string) => void
}) {
  const { dag, columns, total, landedCount } = summary
  const progressLabel = `${landedCount} of ${total} landed`

  return (
    <section
      class="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/40 p-3"
      data-testid={`ship-pipeline-board-${dag.id}`}
    >
      <header class="flex items-center gap-2 flex-wrap">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Ship pipeline
        </span>
        <span class="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
          {dag.id}
        </span>
        <span class="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {progressLabel}
        </span>
      </header>
      <div class="flex gap-2 overflow-x-auto pb-1">
        {SHIP_COLUMN_ORDER.map((column) => (
          <Column
            key={column}
            column={column}
            nodes={columns[column]}
            isDark={isDark}
            onOpenChat={onOpenChat}
          />
        ))}
      </div>
    </section>
  )
}

export function ShipPipelineView({ dags, onOpenChat }: ShipPipelineViewProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const pipelines = useMemo(() => selectShipPipelines(dags), [dags])

  if (pipelines.length === 0) {
    return (
      <div
        class="flex items-center justify-center flex-1 p-8 text-center text-sm text-slate-500 dark:text-slate-400"
        data-testid="ship-pipeline-empty"
      >
        <div class="max-w-sm">
          <div class="text-lg font-medium text-slate-700 dark:text-slate-200 mb-1">
            No ship pipelines yet
          </div>
          <div>
            Ship pipelines appear here when a DAG enters CI or lands.
            Start one with <span class="font-mono">/ship</span>.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      class="flex flex-col gap-4 p-4 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900"
      data-testid="ship-pipeline-view"
    >
      {pipelines.map((p) => (
        <PipelineBoard
          key={p.dag.id}
          summary={p}
          isDark={isDark}
          onOpenChat={onOpenChat}
        />
      ))}
    </div>
  )
}
