import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { ThemeToggle } from '../chat/ThemeToggle'
import type { ViewMode } from '../App'
import { viewMode } from '../App'

const menuOpen = signal(false)

export { menuOpen }

export function HeaderMenu({
  onMemory,
  onRuntimeConfig,
  onClean,
  onRefresh,
  showMemory,
  memoryProposalsCount,
  showRuntimeConfig,
  showClean,
  cleaning,
}: {
  onMemory?: () => void
  onRuntimeConfig?: () => void
  onClean?: () => void
  onRefresh: () => void
  showMemory: boolean
  memoryProposalsCount?: number
  showRuntimeConfig: boolean
  showClean: boolean
  cleaning: boolean
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen.value) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        menuOpen.value = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen.value])

  const closeMenu = () => {
    menuOpen.value = false
  }

  const handleViewChange = (mode: ViewMode) => {
    viewMode.value = mode
    closeMenu()
  }

  return (
    <div class="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => { menuOpen.value = !menuOpen.value }}
        class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-base hover:bg-slate-100 dark:hover:bg-slate-700"
        title="Menu"
        aria-label="Open menu"
        data-testid="header-menu-btn"
      >
        <span aria-hidden="true">☰</span>
      </button>
      {menuOpen.value && (
        <div
          class="absolute right-0 top-full mt-1 w-56 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg z-50 py-1"
          data-testid="header-menu-dropdown"
        >
          <div class="px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            View
          </div>
          <button
            type="button"
            onClick={() => handleViewChange('list')}
            class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
              viewMode.value === 'list' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-200'
            }`}
            data-testid="menu-view-list"
          >
            <span aria-hidden="true">☰</span>
            <span>List</span>
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('kanban')}
            class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
              viewMode.value === 'kanban' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-200'
            }`}
            data-testid="menu-view-kanban"
          >
            <span aria-hidden="true">📋</span>
            <span>Kanban</span>
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('canvas')}
            class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
              viewMode.value === 'canvas' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-200'
            }`}
            data-testid="menu-view-canvas"
          >
            <span aria-hidden="true">◎</span>
            <span>Canvas</span>
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('ship')}
            class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
              viewMode.value === 'ship' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-200'
            }`}
            data-testid="menu-view-ship"
          >
            <span aria-hidden="true">🚀</span>
            <span>Ship</span>
          </button>
          <div class="border-t border-slate-200 dark:border-slate-700 my-1" />
          <div class="px-3 py-2 flex items-center justify-between">
            <span class="text-sm text-slate-700 dark:text-slate-200">Theme</span>
            <ThemeToggle />
          </div>
          {showMemory && onMemory && (
            <>
              <div class="border-t border-slate-200 dark:border-slate-700 my-1" />
              <button
                type="button"
                onClick={() => {
                  onMemory()
                  closeMenu()
                }}
                class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                data-testid="menu-memory"
              >
                <span aria-hidden="true">🧠</span>
                <span>Memory</span>
                {memoryProposalsCount !== undefined && memoryProposalsCount > 0 && (
                  <span
                    class="ml-auto rounded-full bg-indigo-600 text-white text-xs font-medium px-2 py-0.5"
                    data-testid="menu-memory-badge"
                  >
                    {memoryProposalsCount}
                  </span>
                )}
              </button>
            </>
          )}
          {showRuntimeConfig && onRuntimeConfig && (
            <>
              <div class="border-t border-slate-200 dark:border-slate-700 my-1" />
              <button
                type="button"
                onClick={() => {
                  onRuntimeConfig()
                  closeMenu()
                }}
                class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                data-testid="menu-runtime-config"
              >
                <span aria-hidden="true">⚙️</span>
                <span>Runtime Config</span>
              </button>
            </>
          )}
          {showClean && onClean && (
            <button
              type="button"
              onClick={() => {
                void onClean()
                closeMenu()
              }}
              disabled={cleaning}
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="menu-clean"
            >
              <span aria-hidden="true">🧹</span>
              <span>{cleaning ? 'Cleaning…' : 'Clean'}</span>
            </button>
          )}
          <div class="border-t border-slate-200 dark:border-slate-700 my-1" />
          <button
            type="button"
            onClick={() => {
              onRefresh()
              closeMenu()
            }}
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="menu-refresh"
          >
            <span aria-hidden="true">🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      )}
    </div>
  )
}
