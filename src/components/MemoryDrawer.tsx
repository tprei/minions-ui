import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ConnectionStore } from '../state/types'
import type { MemoryEntry, MemoryStatus } from '../api/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTheme } from '../hooks/useTheme'
import { hasFeature } from '../api/features'
import { createMemoryStore } from '../state/memory-store'
import { MemoryRow } from './MemoryRow'
import { MemoryEditor } from './MemoryEditor'
import { MemorySearch } from './MemorySearch'
import { confirm } from '../hooks/useConfirm'

interface Props {
  store: ConnectionStore
  onClose: () => void
}

type TabId = 'inbox' | 'library' | 'archive'

export function MemoryDrawer({ store, onClose }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [activeTab, setActiveTab] = useState<TabId>('inbox')
  const [editingMemory, setEditingMemory] = useState<MemoryEntry | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const memoryStore = useMemo(() => createMemoryStore(store.client), [store.client])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMemory) {
          setEditingMemory(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, editingMemory])

  useEffect(() => {
    if (!hasFeature(store, 'memory')) return
    void memoryStore.fetch()

    const handleReconnect = () => {
      void memoryStore.fetch()
    }

    const unsubscribe = store.status.subscribe(() => {
      if (store.status.value === 'live') {
        handleReconnect()
      }
    })

    return () => {
      unsubscribe()
      memoryStore.dispose()
    }
  }, [store, memoryStore])

  useEffect(() => {
    const statusMap: Record<TabId, MemoryStatus | 'all'> = {
      inbox: 'pending',
      library: 'approved',
      archive: 'all',
    }
    memoryStore.setFilters({
      status: statusMap[activeTab],
      query: searchQuery || undefined,
    })
  }, [activeTab, searchQuery, memoryStore])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
  }

  const handleApprove = async (id: number) => {
    await memoryStore.approve(id)
  }

  const handleReject = async (id: number) => {
    await memoryStore.reject(id)
  }

  const handleEdit = (memory: MemoryEntry) => {
    setEditingMemory(memory)
  }

  const handleSaveEdit = async (updates: { title: string; body: string; pinned: boolean }) => {
    if (!editingMemory) return
    await memoryStore.update(editingMemory.id, updates)
    setEditingMemory(null)
  }

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this memory?',
      message: 'This action cannot be undone.',
      destructive: true,
    })
    if (!ok) return
    await memoryStore.delete(id)
  }

  const handleViewSource = (sessionId: string) => {
    const session = store.sessions.value.find((s) => s.id === sessionId)
    if (!session) {
      void confirm({
        title: 'Session not found',
        message: 'The source session for this memory no longer exists or has been deleted.',
        mode: 'alert',
      })
      return
    }
  }

  const panelBg = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'

  const filteredMemories = useMemo(() => {
    const memories = memoryStore.memories.value
    if (!Array.isArray(memories)) return []

    if (activeTab === 'inbox') {
      return memories.filter((m) => m.status === 'pending')
    }
    if (activeTab === 'library') {
      return memories.filter((m) => m.status === 'approved')
    }
    return memories.filter(
      (m) => m.status === 'rejected' || m.status === 'superseded' || m.status === 'pending_deletion',
    )
  }, [memoryStore.memories.value, activeTab])

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

      {hasFeature(store, 'memory') ? (
        <>
          <div class={`border-b ${borderColor}`}>
            <div class="flex">
              {(['inbox', 'library', 'archive'] as const).map((tab) => {
                const isActive = activeTab === tab
                const label = tab.charAt(0).toUpperCase() + tab.slice(1)
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    class={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? isDark
                          ? 'bg-gray-700 text-white border-b-2 border-indigo-500'
                          : 'bg-gray-50 text-slate-900 border-b-2 border-indigo-600'
                        : isDark
                          ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-gray-50'
                    }`}
                    data-testid={`tab-${tab}`}
                  >
                    {label}
                    {tab === 'inbox' && store.memoryProposalsCount.value > 0 && (
                      <span class="ml-1.5 rounded-full bg-indigo-600 text-white text-xs px-1.5 py-0.5">
                        {store.memoryProposalsCount.value}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div class={`px-4 py-3 border-b ${borderColor}`}>
            <MemorySearch value={searchQuery} onSearch={handleSearch} />
          </div>

          <div class="flex-1 overflow-y-auto">
            {memoryStore.loading.value ? (
              <div class="p-8 flex items-center justify-center">
                <div class={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                  Loading...
                </div>
              </div>
            ) : memoryStore.error.value ? (
              <div class="p-8 flex flex-col items-center justify-center gap-2">
                <div class={`text-sm font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  Error loading memories
                </div>
                <div class={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                  {memoryStore.error.value}
                </div>
              </div>
            ) : filteredMemories.length === 0 ? (
              <div class="p-8 flex items-center justify-center">
                <div class={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                  {searchQuery ? 'No memories found' : `No ${activeTab} memories`}
                </div>
              </div>
            ) : (
              <div data-testid="memory-list">
                {filteredMemories.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    onEdit={handleEdit}
                    onApprove={activeTab === 'inbox' ? handleApprove : undefined}
                    onReject={activeTab === 'inbox' ? handleReject : undefined}
                    onDelete={handleDelete}
                    onViewSource={handleViewSource}
                    showActions={activeTab === 'inbox' || activeTab === 'library'}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div class="flex-1 overflow-y-auto">
          <div class="p-8 flex flex-col items-center justify-center gap-3 text-center">
            <div class={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Memory not available
            </div>
            <div class={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              This minion engine does not support the memory feature. Please upgrade to a version
              with memory support.
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (isDesktop.value) {
    return (
      <>
        <div class="fixed inset-x-0 top-0 z-50 flex h-[100dvh]">
          <div
            class="absolute inset-0 bg-black/50"
            data-testid="drawer-backdrop"
            onClick={onClose}
          />
          <div
            class={`relative ml-auto w-full max-w-md h-full shadow-2xl flex flex-col border-l ${borderColor} ${panelBg}`}
          >
            {inner}
          </div>
        </div>
        {editingMemory && (
          <MemoryEditor
            memory={editingMemory}
            onSave={handleSaveEdit}
            onCancel={() => setEditingMemory(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
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
      {editingMemory && (
        <MemoryEditor
          memory={editingMemory}
          onSave={handleSaveEdit}
          onCancel={() => setEditingMemory(null)}
        />
      )}
    </>
  )
}
