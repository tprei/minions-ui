import { useMemo } from 'preact/hooks'
import type { ApiSession, ApiDagGraph } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { StatusBadge, formatRelativeTime } from './shared'
import { PrLink } from './PrLink'
import { statusDot } from './SessionList'
import { vibrateLight } from '../a11y'

export type KanbanColumn = 'pending' | 'running' | 'completed' | 'failed'

const COLUMN_ORDER: KanbanColumn[] = ['pending', 'running', 'completed', 'failed']

const COLUMN_LABELS: Record<KanbanColumn, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

const COLUMN_ACCENTS: Record<KanbanColumn, { light: string; dark: string; label: string }> = {
  pending: {
    light: 'border-slate-300 bg-slate-50',
    dark: 'border-slate-700 bg-slate-950/30',
    label: 'text-slate-700 dark:text-slate-300',
  },
  running: {
    light: 'border-blue-300 bg-blue-50',
    dark: 'border-blue-700 bg-blue-950/30',
    label: 'text-blue-700 dark:text-blue-300',
  },
  completed: {
    light: 'border-emerald-300 bg-emerald-50',
    dark: 'border-emerald-700 bg-emerald-950/30',
    label: 'text-emerald-700 dark:text-emerald-300',
  },
  failed: {
    light: 'border-red-300 bg-red-50',
    dark: 'border-red-700 bg-red-950/30',
    label: 'text-red-700 dark:text-red-300',
  },
}

interface SessionCardProps {
  session: ApiSession
  onOpenChat: (sessionId: string) => void
  isDark: boolean
}

function SessionCard({ session, onOpenChat, isDark }: SessionCardProps) {
  const handleClick = () => {
    vibrateLight()
    onOpenChat(session.id)
  }

  const preview = session.command.slice(0, 50)
  const needsAttentionRing = session.needsAttention
    ? isDark
      ? 'ring-2 ring-amber-500/40'
      : 'ring-2 ring-amber-400/60'
    : ''

  return (
    <button
      type="button"
      onClick={handleClick}
      class={`w-full text-left flex flex-col gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm transition-all active:scale-[0.98] hover:shadow-md ${needsAttentionRing}`}
      data-testid={`kanban-card-${session.id}`}
    >
      <div class="flex items-center gap-2">
        <span class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot(session.status)}`} />
        <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
          {session.slug}
        </span>
        <StatusBadge status={session.status} />
      </div>
      <div class="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
        {preview || '—'}
      </div>
      <div class="flex items-center justify-between gap-2">
        {session.prUrl ? (
          <div onClick={(e: Event) => e.stopPropagation()}>
            <PrLink prUrl={session.prUrl} compact />
          </div>
        ) : session.branch ? (
          <span class="text-[11px] font-mono truncate text-slate-500 dark:text-slate-400 max-w-[180px]">
            {session.branch}
          </span>
        ) : (
          <span class="text-[11px] text-slate-400 dark:text-slate-500 italic">—</span>
        )}
        <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>
      {session.needsAttention && session.attentionReasons.length > 0 && (
        <div class="flex items-center gap-1 flex-wrap">
          {session.attentionReasons.map((reason) => (
            <span
              key={reason}
              class="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200"
            >
              {reason.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

interface SwimLaneProps {
  column: KanbanColumn
  sessions: ApiSession[]
  isDark: boolean
  onOpenChat: (sessionId: string) => void
}

function SwimLane({ column, sessions, isDark, onOpenChat }: SwimLaneProps) {
  const accent = COLUMN_ACCENTS[column]
  const bg = isDark ? accent.dark : accent.light

  return (
    <section class={`flex flex-col gap-3 rounded-lg border ${bg} p-3`} data-testid={`kanban-lane-${column}`}>
      <header class="flex items-center justify-between sticky top-0 z-10 bg-inherit pb-2 border-b border-slate-200 dark:border-slate-700">
        <h2 class={`text-sm font-semibold uppercase tracking-wide ${accent.label}`}>
          {COLUMN_LABELS[column]}
        </h2>
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">{sessions.length}</span>
      </header>
      <div class="flex flex-col gap-2">
        {sessions.length === 0 ? (
          <div class="text-xs italic text-slate-400 dark:text-slate-500 px-2 py-4 text-center">
            No {column} sessions
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard key={session.id} session={session} onOpenChat={onOpenChat} isDark={isDark} />
          ))
        )}
      </div>
    </section>
  )
}

export interface MobileKanbanProps {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  onOpenChat: (sessionId: string) => void
}

export function MobileKanban({ sessions, onOpenChat }: MobileKanbanProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  const sessionsByStatus = useMemo(() => {
    const grouped: Record<KanbanColumn, ApiSession[]> = {
      pending: [],
      running: [],
      completed: [],
      failed: [],
    }

    const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

    for (const session of sorted) {
      if (session.status in grouped) {
        grouped[session.status].push(session)
      }
    }

    return grouped
  }, [sessions])

  if (sessions.length === 0) {
    return (
      <div
        class="flex items-center justify-center flex-1 p-8 text-center text-sm text-slate-500 dark:text-slate-400"
        data-testid="kanban-empty"
      >
        <div class="max-w-sm">
          <div class="text-lg font-medium text-slate-700 dark:text-slate-200 mb-1">
            No sessions yet
          </div>
          <div>
            Sessions appear here organized by status.
            Start one from the task bar above.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      class="flex flex-col gap-3 p-3 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900"
      data-testid="mobile-kanban-view"
    >
      {COLUMN_ORDER.map((column) => (
        <SwimLane
          key={column}
          column={column}
          sessions={sessionsByStatus[column]}
          isDark={isDark}
          onOpenChat={onOpenChat}
        />
      ))}
    </div>
  )
}
