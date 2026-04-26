import { useSignal } from '@preact/signals'
import { useEffect, useCallback } from 'preact/hooks'
import { connections, activeId, removeConnection, setActive } from './store'
import { confirm } from '../hooks/useConfirm'
import { ConnectionSettings } from './ConnectionSettings'
import type { Connection } from './types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTheme } from '../hooks/useTheme'

interface ConnectionsDrawerProps {
  onClose: () => void
}

type DrawerPanel = 'list' | 'add' | 'edit'

export function ConnectionsDrawer({ onClose }: ConnectionsDrawerProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const panel = useSignal<DrawerPanel>('list')
  const editingConn = useSignal<Connection | null>(null)

  const handleClose = useCallback(() => {
    panel.value = 'list'
    editingConn.value = null
    onClose()
  }, [panel, editingConn, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleClose])

  const handleDelete = useCallback(async (conn: Connection) => {
    const ok = await confirm({
      destructive: true,
      message: `Remove connection ${conn.label}?`,
    })
    if (!ok) return
    if (activeId.value === conn.id) setActive(null)
    removeConnection(conn.id)
  }, [])

  const handleEdit = useCallback((conn: Connection) => {
    editingConn.value = conn
    panel.value = 'edit'
  }, [panel, editingConn])

  const handleAdd = useCallback(() => {
    editingConn.value = null
    panel.value = 'add'
  }, [panel, editingConn])

  const handleSettingsDone = useCallback(() => {
    panel.value = 'list'
    editingConn.value = null
  }, [panel, editingConn])

  const panelBg = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'

  const inner = (
    <div
      class={`flex flex-col h-full ${panelBg}`}
      data-testid="connections-drawer"
    >
      <header class={`flex items-center gap-2 px-4 py-3 border-b shrink-0 ${borderColor}`}>
        {panel.value !== 'list' && (
          <button
            data-testid="drawer-back-btn"
            onClick={() => { panel.value = 'list'; editingConn.value = null }}
            class={`mr-1 text-lg min-w-[44px] min-h-[44px] flex items-center justify-center ${isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            ←
          </button>
        )}
        <span class={`flex-1 font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {panel.value === 'list' ? 'Connections' : panel.value === 'add' ? 'Add connection' : 'Edit connection'}
        </span>
        <button
          data-testid="drawer-close-btn"
          onClick={handleClose}
          class={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-slate-500'}`}
          aria-label="Close drawer"
        >
          <span class="text-lg leading-none">&times;</span>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        {panel.value === 'list' && (
          <div class="flex flex-col">
            <ul data-testid="connections-list">
              {connections.value.map((conn) => (
                <li
                  key={conn.id}
                  data-testid={`drawer-conn-${conn.id}`}
                  class={`flex items-center gap-3 px-4 py-3 border-b ${borderColor}`}
                >
                  <span
                    class="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: conn.color }}
                  />
                  <div class="flex-1 min-w-0">
                    <div class={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>{conn.label}</div>
                    <div class={`text-xs truncate ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{conn.baseUrl}</div>
                  </div>
                  <button
                    data-testid={`drawer-edit-${conn.id}`}
                    onClick={() => handleEdit(conn)}
                    class={`text-xs px-3 py-2.5 rounded transition-colors min-h-[44px] ${isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    Edit
                  </button>
                  <button
                    data-testid={`drawer-delete-${conn.id}`}
                    onClick={() => void handleDelete(conn)}
                    class="text-xs px-3 py-2.5 rounded transition-colors text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 min-h-[44px]"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div class="px-4 py-3">
              <button
                data-testid="drawer-add-btn"
                onClick={handleAdd}
                class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Add connection
              </button>
            </div>
          </div>
        )}
        {(panel.value === 'add' || panel.value === 'edit') && (
          <div class="p-4">
            <ConnectionSettings
              existing={editingConn.value ?? undefined}
              onClose={handleSettingsDone}
              embedded
            />
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
          onClick={handleClose}
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
        onClick={handleClose}
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
