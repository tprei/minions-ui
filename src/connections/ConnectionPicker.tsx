import { useSignal, useComputed } from '@preact/signals'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import { connections, activeId, setActive, getAllStores } from './store'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipeToDismiss } from '../hooks/useSwipeToDismiss'
import { useHaptics } from '../hooks/useHaptics'
import { computeConnectionStats, type ConnectionStats } from './stats'

interface ConnectionPickerProps {
  onManage: () => void
}

export function ConnectionPicker({ onManage }: ConnectionPickerProps) {
  const open = useSignal(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const activeConn = connections.value.find((c) => c.id === activeId.value) ?? null
  const { vibrate } = useHaptics()

  const connectionStats = useComputed<Map<string, ConnectionStats>>(() => {
    const stores = getAllStores()
    const statsMap = new Map<string, ConnectionStats>()
    for (const conn of connections.value) {
      const store = stores.get(conn.id)
      if (store) {
        statsMap.set(
          conn.id,
          computeConnectionStats(store.sessions.value, store.dags.value),
        )
      }
    }
    return statsMap
  })

  const handleClose = useCallback(() => {
    open.value = false
  }, [open])

  const swipeRef = useSwipeToDismiss({
    onDismiss: handleClose,
    threshold: 100,
    enabled: !isDesktop.value,
  })

  useEffect(() => {
    if (!isDesktop.value && sheetRef.current) {
      swipeRef.current = sheetRef.current
    }
  }, [isDesktop.value, swipeRef])

  const handleToggle = useCallback(() => {
    open.value = !open.value
    if (!open.value) {
      vibrate('light')
    }
  }, [open, vibrate])

  const handleSelect = useCallback((id: string) => {
    vibrate('light')
    setActive(id)
    open.value = false
  }, [open, vibrate])

  const handleManage = useCallback(() => {
    vibrate('light')
    open.value = false
    onManage()
  }, [open, onManage, vibrate])

  useEffect(() => {
    if (!open.value || !isDesktop.value) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        open.value = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open.value, open, isDesktop.value])

  useEffect(() => {
    if (!open.value) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open.value = false
        return
      }
      if (!isDesktop.value) return
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
  }, [open.value, open, isDesktop.value])

  const activeStats = activeConn ? connectionStats.value.get(activeConn.id) : null

  const triggerButton = (
    <button
      data-testid="connection-picker-trigger"
      onClick={handleToggle}
      aria-haspopup="listbox"
      aria-expanded={open.value}
      class="w-full flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 sm:px-4 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors min-w-0 min-h-[44px]"
    >
      {activeConn ? (
        <>
          <span class="relative shrink-0">
            <span
              class="h-2.5 w-2.5 rounded-full block"
              style={{ backgroundColor: activeConn.color }}
              data-testid="picker-active-dot"
            />
            {activeStats && activeStats.unreadCount > 0 && (
              <span
                class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-1 ring-white dark:ring-slate-800"
                data-testid="picker-trigger-unread"
                aria-label={`${activeStats.unreadCount} unread`}
              />
            )}
          </span>
          <span class="flex-1 min-w-0 truncate text-left">{activeConn.label}</span>
        </>
      ) : (
        <span class="flex-1 min-w-0 truncate text-left text-slate-500">No connection</span>
      )}
      <span class="text-slate-400 text-xs shrink-0">{open.value ? '▲' : '▼'}</span>
    </button>
  )

  const connectionsList = (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Connections"
      class={isDesktop.value ? 'max-h-64 overflow-y-auto' : ''}
    >
      {connections.value.map((conn) => {
        const stats = connectionStats.value.get(conn.id)
        return (
          <li key={conn.id}>
            <button
              role="option"
              aria-selected={conn.id === activeId.value}
              tabIndex={0}
              data-testid={`picker-option-${conn.id}`}
              onClick={() => handleSelect(conn.id)}
              class={`w-full flex items-center gap-2 px-3 py-3 text-sm text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px] ${conn.id === activeId.value ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}
            >
              <span class="relative shrink-0">
                <span
                  class="h-2.5 w-2.5 rounded-full block"
                  style={{ backgroundColor: conn.color }}
                />
                {stats && stats.unreadCount > 0 && (
                  <span
                    class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-1 ring-white dark:ring-slate-800"
                    data-testid={`picker-unread-${conn.id}`}
                    aria-label={`${stats.unreadCount} unread`}
                  />
                )}
              </span>
              <span class="truncate flex-1 min-w-0">{conn.label}</span>
              {stats?.dagProgress && (
                <span
                  class="shrink-0 flex items-center gap-1 text-[10px] tabular-nums text-slate-500 dark:text-slate-400"
                  data-testid={`picker-dag-stats-${conn.id}`}
                >
                  <span class="text-green-600 dark:text-green-400">{stats.dagProgress.done}</span>
                  <span>/</span>
                  <span>{stats.dagProgress.total}</span>
                  {stats.dagProgress.failed > 0 && (
                    <>
                      <span class="mx-0.5">·</span>
                      <span class="text-red-600 dark:text-red-400">
                        {stats.dagProgress.failed} failed
                      </span>
                    </>
                  )}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )

  const manageButton = (
    <button
      data-testid="picker-manage-btn"
      onClick={handleManage}
      class="w-full px-3 py-3 text-sm text-left text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors min-h-[44px]"
    >
      Manage connections
    </button>
  )

  if (isDesktop.value) {
    return (
      <div class="relative min-w-0 flex-1 max-w-[14rem]" ref={containerRef}>
        {triggerButton}
        {open.value && (
          <div
            class="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
            data-testid="connection-picker-dropdown"
          >
            {connectionsList}
            <div class="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1">
              {manageButton}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div class="relative min-w-0 flex-1 max-w-[14rem]">
        {triggerButton}
      </div>
      {open.value && (
        <div class="fixed inset-x-0 top-0 z-50 h-[100dvh]">
          <div
            class="absolute inset-0 bg-black/50"
            data-testid="picker-backdrop"
            onClick={handleClose}
          />
          <div
            ref={sheetRef}
            class="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 max-h-[70dvh]"
            data-testid="connection-picker-sheet"
          >
            <div class="flex justify-center pt-2 pb-1 shrink-0">
              <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div class="px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Select connection
              </h3>
            </div>
            <div class="flex-1 overflow-y-auto">
              {connectionsList}
            </div>
            <div class="border-t border-slate-200 dark:border-slate-700 shrink-0">
              {manageButton}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
