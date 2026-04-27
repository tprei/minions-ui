import { useComputed } from '@preact/signals'
import { connections, activeId, setActive, getAllStores } from './store'
import { useHaptics } from '../hooks/useHaptics'
import { computeConnectionStats, type ConnectionStats } from './stats'
import type { Connection } from './types'

interface ConnectionRailProps {
  onManage: () => void
}

function initials(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ConnectionRail({ onManage }: ConnectionRailProps) {
  const { vibrate } = useHaptics()
  const conns = connections.value
  const active = activeId.value

  const statsMap = useComputed<Map<string, ConnectionStats>>(() => {
    const stores = getAllStores()
    const map = new Map<string, ConnectionStats>()
    for (const c of connections.value) {
      const s = stores.get(c.id)
      if (s) map.set(c.id, computeConnectionStats(s.sessions.value, s.dags.value))
    }
    return map
  })

  if (conns.length === 0) return null

  const handleSelect = (id: string) => {
    if (id === activeId.value) return
    vibrate('light')
    setActive(id)
  }

  const handleManage = () => {
    vibrate('light')
    onManage()
  }

  return (
    <nav
      data-testid="connection-rail"
      aria-label="Connections"
      class="flex flex-col items-center gap-2 px-2 py-3 border-r border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 shrink-0 w-[68px] overflow-y-auto"
    >
      {conns.map((conn) => {
        const stats = statsMap.value.get(conn.id)
        return (
          <ConnectionAvatar
            key={conn.id}
            conn={conn}
            active={conn.id === active}
            unread={stats?.unreadCount ?? 0}
            failed={stats?.dagProgress?.failed ?? 0}
            onClick={() => handleSelect(conn.id)}
          />
        )
      })}
      <div class="my-1 h-px w-8 bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
      <button
        type="button"
        onClick={handleManage}
        data-testid="connection-rail-manage"
        title="Manage connections"
        aria-label="Manage connections"
        class="w-12 h-12 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500 hover:rounded-xl transition-all"
      >
        <span class="text-xl leading-none" aria-hidden="true">+</span>
      </button>
    </nav>
  )
}

interface ConnectionAvatarProps {
  conn: Connection
  active: boolean
  unread: number
  failed: number
  onClick: () => void
}

function ConnectionAvatar({ conn, active, unread, failed, onClick }: ConnectionAvatarProps) {
  const labelParts = [conn.label]
  if (unread > 0) labelParts.push(`${unread} unread`)
  if (failed > 0) labelParts.push(`${failed} failed`)
  const ariaLabel = labelParts.join(', ')

  return (
    <div class="relative">
      {active && (
        <span
          aria-hidden="true"
          data-testid={`rail-active-indicator-${conn.id}`}
          class="absolute -left-2 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-slate-900 dark:bg-white"
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        aria-label={ariaLabel}
        title={conn.label}
        data-testid={`rail-conn-${conn.id}`}
        class={`relative w-12 h-12 flex items-center justify-center text-white text-sm font-semibold transition-all duration-150 ${active ? 'rounded-xl' : 'rounded-2xl hover:rounded-xl'}`}
        style={{ backgroundColor: conn.color }}
      >
        <span aria-hidden="true">{initials(conn.label)}</span>
        {unread > 0 && (
          <span
            data-testid={`rail-unread-${conn.id}`}
            class="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-medium px-1 flex items-center justify-center ring-2 ring-slate-100 dark:ring-slate-950"
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {unread === 0 && failed > 0 && (
          <span
            data-testid={`rail-failed-${conn.id}`}
            class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-slate-100 dark:ring-slate-950"
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  )
}
