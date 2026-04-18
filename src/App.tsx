import { signal } from '@preact/signals'
import { useSignal } from '@preact/signals'
import { useState, useEffect } from 'preact/hooks'
import { useRegisterSW } from 'virtual:pwa-register/preact'
import { connections, activeId, getActiveStore } from './connections/store'
import { ConnectionSettings } from './connections/ConnectionSettings'
import { ConnectionPicker } from './connections/ConnectionPicker'
import { ConnectionsDrawer } from './connections/ConnectionsDrawer'
import { UniverseCanvas } from './components/UniverseCanvas'
import { ChatPanel } from './chat/ChatPanel'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
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

function NewTaskBar({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const text = useSignal('')
  const sending = useSignal(false)
  const error = useSignal<string | null>(null)

  const submit = async () => {
    const value = text.value.trim()
    if (!value || sending.value) return
    sending.value = true
    error.value = null
    try {
      await onSend(value)
      text.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Send failed'
    } finally {
      sending.value = false
    }
  }

  return (
    <div class="flex flex-col gap-1 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div class="flex items-center gap-2">
        <input
          type="text"
          value={text.value}
          onInput={(e) => { text.value = (e.currentTarget as HTMLInputElement).value }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
          disabled={sending.value}
          placeholder="/task <prompt>, /plan, /think, /dag, /split, /stack, /doctor, /ship"
          class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
        />
        <button
          onClick={() => void submit()}
          disabled={sending.value || !text.value.trim()}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {sending.value ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error.value && <div class="text-xs text-red-600 dark:text-red-400">{error.value}</div>}
    </div>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const conn = connections.value.find((c) => c.id === id)
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const isOnline = useOnlineStatus()

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

  const showOfflineBanner = !isOnline.value && store.stale.value

  return (
    <div class="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-900">
      {showOfflineBanner && (
        <div class="flex items-center justify-center px-4 py-2 bg-amber-500 text-amber-950 text-xs font-medium" data-testid="offline-banner">
          Offline — showing last snapshot
        </div>
      )}
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
      <NewTaskBar onSend={(text) => store.client.sendMessage(text).then(() => undefined)} />
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

function PwaController() {
  useRegisterSW({
    onNeedRefresh() {},
    onOfflineReady() {},
  })
  return null
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
        <InstallPrompt />
        <PwaController />
      </>
    )
  }

  return (
    <>
      <ActiveView />
      <ConfirmRoot />
      <InstallPrompt />
      <PwaController />
    </>
  )
}
