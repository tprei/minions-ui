import { useMemo, useCallback, useState, useRef, useEffect } from 'preact/hooks'
import type { ApiSession, ApiDagGraph } from '../api/types'
import { StatusBadge, AttentionIconStack, formatRelativeTime } from './shared'
import { PrLink } from './PrLink'
import { useTheme } from '../hooks/useTheme'
import { useHaptics } from '../hooks/useHaptics'
import { connections, activeId, setActive } from '../connections/store'

interface KanbanCardProps {
  session: ApiSession
  onClick: (sessionId: string) => void
  isDark: boolean
}

function KanbanCard({ session, onClick, isDark }: KanbanCardProps) {
  const { vibrate } = useHaptics()

  const handleClick = useCallback(() => {
    vibrate('light')
    onClick(session.id)
  }, [session.id, onClick, vibrate])

  const bgColor = isDark ? 'bg-slate-800' : 'bg-white'
  const borderColor = session.needsAttention
    ? 'border-amber-500 dark:border-amber-600'
    : 'border-slate-200 dark:border-slate-700'

  return (
    <button
      type="button"
      onClick={handleClick}
      class={`${bgColor} ${borderColor} border-2 rounded-lg p-3 w-full text-left shadow-sm active:scale-[0.98] transition-transform min-h-[88px] flex flex-col gap-2`}
      data-testid={`kanban-card-${session.id}`}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate flex-1">
          {session.slug}
        </div>
        <StatusBadge status={session.status} />
      </div>

      {session.needsAttention && session.attentionReasons.length > 0 && (
        <div class="flex items-center gap-1.5">
          <AttentionIconStack reasons={session.attentionReasons} darkMode={isDark} />
        </div>
      )}

      <div class="flex items-center justify-between gap-2 mt-auto">
        {session.prUrl ? (
          <div onClick={(e: Event) => e.stopPropagation()}>
            <PrLink prUrl={session.prUrl} compact />
          </div>
        ) : session.branch ? (
          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
            {session.branch}
          </div>
        ) : session.command ? (
          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
            {session.command}
          </div>
        ) : (
          <div />
        )}
        {session.updatedAt && (
          <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
            {formatRelativeTime(session.updatedAt)}
          </span>
        )}
      </div>
    </button>
  )
}

interface KanbanColumnProps {
  title: string
  emoji: string
  sessions: ApiSession[]
  onCardClick: (sessionId: string) => void
  isDark: boolean
}

function KanbanColumn({ title, emoji, sessions, onCardClick, isDark }: KanbanColumnProps) {
  const bgColor = isDark ? 'bg-slate-900' : 'bg-slate-50'
  const headerBg = isDark ? 'bg-slate-800' : 'bg-slate-100'

  return (
    <div class={`${bgColor} rounded-lg flex flex-col h-full`}>
      <div class={`${headerBg} rounded-t-lg px-3 py-2 sticky top-0 z-10`}>
        <div class="flex items-center gap-2">
          <span class="text-lg" aria-hidden="true">{emoji}</span>
          <span class="font-semibold text-sm text-slate-900 dark:text-slate-100">
            {title}
          </span>
          <span class="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400">
            {sessions.length}
          </span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2 space-y-2">
        {sessions.length === 0 ? (
          <div class="text-center py-8 text-xs text-slate-400 dark:text-slate-500">
            No sessions
          </div>
        ) : (
          sessions.map((session) => (
            <KanbanCard
              key={session.id}
              session={session}
              onClick={onCardClick}
              isDark={isDark}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface ConnectionDotProps {
  active: boolean
  color: string
  onClick: () => void
}

function ConnectionDot({ active, color, onClick }: ConnectionDotProps) {
  const { vibrate } = useHaptics()

  const handleClick = useCallback(() => {
    vibrate('light')
    onClick()
  }, [onClick, vibrate])

  return (
    <button
      type="button"
      onClick={handleClick}
      class={`w-2 h-2 rounded-full transition-transform ${active ? 'scale-150' : 'scale-100'}`}
      style={{ backgroundColor: color }}
      aria-label="Switch connection"
    />
  )
}

export interface KanbanViewProps {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  onSessionSelect: (sessionId: string) => void
}

export function KanbanView({ sessions, onSessionSelect }: KanbanViewProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentConnIndex, setCurrentConnIndex] = useState(0)
  const { vibrate } = useHaptics()

  const conns = connections.value
  const activeConnId = activeId.value

  useEffect(() => {
    const idx = conns.findIndex((c) => c.id === activeConnId)
    if (idx !== -1) setCurrentConnIndex(idx)
  }, [activeConnId, conns])

  const columns = useMemo(() => {
    const running = sessions.filter((s) => s.status === 'running')
    const done = sessions.filter((s) => s.status === 'completed' || s.status === 'failed')
    const waiting = sessions.filter((s) =>
      s.status !== 'running' &&
      s.status !== 'completed' &&
      s.status !== 'failed'
    )

    return { running, waiting, done }
  }, [sessions])

  const handleSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (conns.length <= 1) return

      const nextIndex =
        direction === 'left'
          ? (currentConnIndex + 1) % conns.length
          : (currentConnIndex - 1 + conns.length) % conns.length

      const nextConn = conns[nextIndex]
      if (nextConn) {
        vibrate('medium')
        setActive(nextConn.id)
        setCurrentConnIndex(nextIndex)
      }
    },
    [conns, currentConnIndex, vibrate]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let startX = 0
    let startY = 0
    let deltaX = 0
    let deltaY = 0

    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      deltaX = 0
      deltaY = 0
    }

    const handleTouchMove = (e: TouchEvent) => {
      deltaX = e.touches[0].clientX - startX
      deltaY = e.touches[0].clientY - startY
    }

    const handleTouchEnd = () => {
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)

      if (absDeltaX > 80 && absDeltaX > absDeltaY * 1.5) {
        handleSwipe(deltaX > 0 ? 'right' : 'left')
      }
    }

    container.addEventListener('touchstart', handleTouchStart)
    container.addEventListener('touchmove', handleTouchMove)
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleSwipe])

  return (
    <div class="flex flex-col h-full" data-testid="kanban-view">
      {conns.length > 1 && (
        <div class="flex items-center justify-center gap-2 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          {conns.map((conn, idx) => (
            <ConnectionDot
              key={conn.id}
              active={idx === currentConnIndex}
              color={conn.color}
              onClick={() => {
                setActive(conn.id)
                setCurrentConnIndex(idx)
              }}
            />
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        class="flex-1 grid grid-cols-3 gap-2 p-2 overflow-hidden"
        style={{ touchAction: 'pan-y' }}
      >
        <KanbanColumn
          title="Running"
          emoji="⚡"
          sessions={columns.running}
          onCardClick={onSessionSelect}
          isDark={isDark}
        />
        <KanbanColumn
          title="Waiting"
          emoji="💬"
          sessions={columns.waiting}
          onCardClick={onSessionSelect}
          isDark={isDark}
        />
        <KanbanColumn
          title="Done"
          emoji="✅"
          sessions={columns.done}
          onCardClick={onSessionSelect}
          isDark={isDark}
        />
      </div>
    </div>
  )
}
