import { useEffect } from 'preact/hooks'
import type { ConnectionStore } from '../state/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTheme } from '../hooks/useTheme'
import { hasFeature } from '../api/features'

interface Props {
  store: ConnectionStore
  onClose: () => void
}

export function MemoryDrawer({ store, onClose }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const panelBg = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'

  const inner = (
    <div class={`flex flex-col h-full ${panelBg}`} data-testid="memory-drawer">
      <header class={`flex items-center gap-2 px-4 py-3 border-b shrink-0 ${borderColor}`}>
        <span class={`flex-1 font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Memory
        </span>
        {store.memoryProposalsCount.value > 0 && (
          <span
            class="rounded-full bg-indigo-600 text-white text-xs font-medium px-2 py-0.5"
            data-testid="memory-proposals-badge"
          >
            {store.memoryProposalsCount.value}
          </span>
        )}
        <button
          onClick={onClose}
          class={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-slate-500'}`}
          aria-label="Close drawer"
          data-testid="memory-drawer-close"
        >
          <span class="text-lg leading-none">&times;</span>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        {hasFeature(store, 'memory') ? (
          <div class="p-8 flex flex-col items-center justify-center gap-3 text-center">
            <div class={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Memory drawer implementation coming soon.
            </div>
            <div class={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              This is a placeholder for the full memory UI (PR 2).
            </div>
          </div>
        ) : (
          <div class="p-8 flex flex-col items-center justify-center gap-3 text-center">
            <div class={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Memory not available
            </div>
            <div class={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              This minion engine does not support the memory feature. Please upgrade to a version with memory support.
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (isDesktop.value) {
    return (
      <div class="fixed inset-x-0 top-0 z-50 flex h-[100dvh]">
        <div
          class="absolute inset-0 bg-black/50"
          data-testid="drawer-backdrop"
          onClick={onClose}
        />
        <div class={`relative ml-auto w-full max-w-md h-full shadow-2xl flex flex-col border-l ${borderColor} ${panelBg}`}>
          {inner}
        </div>
      </div>
    )
  }

  return (
    <div class="fixed inset-x-0 top-0 z-50 h-[100dvh]">
      <div
        class="absolute inset-0 bg-black/50"
        data-testid="drawer-backdrop"
        onClick={onClose}
      />
      <div
        class={`absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl flex flex-col border-t max-h-[85dvh] ${borderColor} ${panelBg}`}
      >
        <div class="flex justify-center pt-2 pb-1 shrink-0">
          <div class={`w-10 h-1 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
        </div>
        {inner}
      </div>
    </div>
  )
}
