import { useSignal } from '@preact/signals'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import { connections, activeId, setActive } from './store'

export interface ConnectionBadgeCounts {
  sessions: number
  attention: number
}

interface ConnectionPickerProps {
  onManage: () => void
  activeCounts?: ConnectionBadgeCounts
}

function CountBadges({ counts, compact = false }: { counts: ConnectionBadgeCounts; compact?: boolean }) {
  const size = compact ? 'text-[10px] px-1.5 py-0' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span class="flex items-center gap-1 shrink-0" data-testid="connection-badges">
      <span
        title={`${counts.sessions} sessions`}
        data-testid="connection-badge-sessions"
        class={`inline-flex items-center rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium tabular-nums ${size}`}
      >
        {counts.sessions}
      </span>
      {counts.attention > 0 && (
        <span
          title={`${counts.attention} needing attention`}
          data-testid="connection-badge-attention"
          class={`inline-flex items-center rounded-full bg-amber-500 text-white font-medium tabular-nums ${size}`}
        >
          !{counts.attention}
        </span>
      )}
    </span>
  )
}

export function ConnectionPicker({ onManage, activeCounts }: ConnectionPickerProps) {
  const open = useSignal(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const activeConn = connections.value.find((c) => c.id === activeId.value) ?? null

  const handleToggle = useCallback(() => {
    open.value = !open.value
  }, [open])

  const handleSelect = useCallback((id: string) => {
    setActive(id)
    open.value = false
  }, [open])

  const handleManage = useCallback(() => {
    open.value = false
    onManage()
  }, [open, onManage])

  useEffect(() => {
    if (!open.value) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        open.value = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open.value, open])

  useEffect(() => {
    if (!open.value) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open.value = false
        return
      }
      const list = listRef.current
      if (!list) return
      const items = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
      const focused = document.activeElement as HTMLElement
      const idx = items.indexOf(focused)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[(idx + 1) % items.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[(idx - 1 + items.length) % items.length]?.focus()
      } else if (e.key === 'Enter' && idx !== -1) {
        e.preventDefault()
        items[idx]?.click()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open.value, open])

  return (
    <div class="relative" ref={containerRef}>
      <button
        data-testid="connection-picker-trigger"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open.value}
        class="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
      >
        {activeConn ? (
          <>
            <span
              class="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: activeConn.color }}
              data-testid="picker-active-dot"
            />
            <span class="max-w-[140px] truncate">{activeConn.label}</span>
            {activeCounts && <CountBadges counts={activeCounts} compact />}
          </>
        ) : (
          <span class="text-slate-500">No connection</span>
        )}
        <span class="text-slate-400 text-xs">{open.value ? '▲' : '▼'}</span>
      </button>

      {open.value && (
        <div
          class="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
          data-testid="connection-picker-dropdown"
        >
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Connections"
            class="max-h-64 overflow-y-auto"
          >
            {connections.value.map((conn) => (
              <li key={conn.id}>
                <button
                  role="option"
                  aria-selected={conn.id === activeId.value}
                  tabIndex={0}
                  data-testid={`picker-option-${conn.id}`}
                  onClick={() => handleSelect(conn.id)}
                  class={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 ${conn.id === activeId.value ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  <span
                    class="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: conn.color }}
                  />
                  <span class="truncate flex-1">{conn.label}</span>
                  {conn.id === activeId.value && activeCounts && (
                    <CountBadges counts={activeCounts} />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div class="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1">
            <button
              data-testid="picker-manage-btn"
              onClick={handleManage}
              class="w-full px-3 py-2 text-sm text-left text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Manage connections
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
