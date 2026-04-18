import { signal } from '@preact/signals'
import { useState, useEffect } from 'preact/hooks'
import { connections, activeId, getActiveStore } from './connections/store'
import { ConnectionSettings } from './connections/ConnectionSettings'
import { ConnectionPicker } from './connections/ConnectionPicker'
import { ConnectionsDrawer } from './connections/ConnectionsDrawer'
import { UniverseCanvas } from './components/UniverseCanvas'
import { ChatPanel } from './chat/ChatPanel'
import { ConfirmRoot } from './hooks/useConfirm'
import type { ApiSession } from './api/types'

const showSettings = signal(false)
const showDrawer = signal(false)

function ConnectionStatusBadge({ status }: { status: string }) {
  const color =
    status === 'live'
      ? 'bg-green-500'
      : status === 'retrying'
        ? 'bg-yellow-500'
        : status === 'connecting'
          ? 'bg-blue-500'
          : 'bg-slate-400'
  return (
    <span class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
      <span class={`inline-block h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const conn = connections.value.find((c) => c.id === id)
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)

  useEffect(() => {
    const color = conn?.color ?? '#3b82f6'
    document.documentElement.style.setProperty('--accent', color)
  }, [conn?.color])

  if (!store || !conn) return null

  const handleSendReply = async (sessionId: string, message: string) => {
    await store.sendCommand({ action: 'reply', sessionId, message })
  }

  const handleStopMinion = async (sessionId: string) => {
    await store.sendCommand({ action: 'stop', sessionId })
  }

  const handleCloseSession = async (sessionId: string) => {
    await store.sendCommand({ action: 'close', sessionId })
  }

  const handleOpenThread = (_session: ApiSession) => {
  }

  const handleOpenChat = (sessionId: string) => {
    setChatSessionId(sessionId)
  }

  const chatSession = chatSessionId
    ? store.sessions.value.find((s) => s.id === chatSessionId) ?? null
    : null

  const handleSendMessage = async (text: string, sessionId: string) => {
    await store.client.sendMessage(text, sessionId)
  }

  return (
    <div class="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-900">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <ConnectionPicker onManage={() => { showDrawer.value = true }} />
        <ConnectionStatusBadge status={store.status.value} />
      </header>
      {store.error.value && (
        <div class="flex items-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <span class="flex-1">{store.error.value}</span>
          <button
            onClick={() => void store.refresh()}
            class="text-xs font-medium underline"
          >
            Retry
          </button>
        </div>
      )}
      <main class="flex-1 overflow-hidden">
        <UniverseCanvas
          sessions={store.sessions.value}
          dags={store.dags.value}
          isLoading={store.status.value === 'connecting'}
          onSendReply={handleSendReply}
          onStopMinion={handleStopMinion}
          onCloseSession={handleCloseSession}
          onOpenThread={handleOpenThread}
          isActionLoading={false}
          onOpenChat={handleOpenChat}
          accentColor={conn.color}
        />
      </main>
      {chatSession && (
        <ChatPanel
          session={chatSession}
          onClose={() => setChatSessionId(null)}
          onSend={handleSendMessage}
          sseStatus={store.status.value}
        />
      )}
      {showDrawer.value && (
        <ConnectionsDrawer onClose={() => { showDrawer.value = false }} />
      )}
    </div>
  )
}

export default function App() {
  if (connections.value.length === 0 || showSettings.value) {
    return (
      <>
        <div class="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
          {showSettings.value ? (
            <ConnectionSettings onClose={() => { showSettings.value = false }} />
          ) : (
            <div class="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
              <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Connect a minion</h1>
              <p class="text-sm text-slate-500 dark:text-slate-400">
                Paste a minion's base URL and token to get started
              </p>
              <button
                onClick={() => { showSettings.value = true }}
                class="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Add connection
              </button>
            </div>
          )}
        </div>
        <ConfirmRoot />
      </>
    )
  }

  return (
    <>
      <ActiveView />
      <ConfirmRoot />
    </>
  )
}
