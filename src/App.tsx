import { signal } from '@preact/signals'
import { useState, useEffect, useCallback } from 'preact/hooks'
import { useRegisterSW } from 'virtual:pwa-register/preact'
import { connections, activeId, getActiveStore } from './connections/store'
import { ConnectionSettings } from './connections/ConnectionSettings'
import { ConnectionPicker } from './connections/ConnectionPicker'
import { ConnectionsDrawer } from './connections/ConnectionsDrawer'
import { ConversationView } from './chat/ConversationView'
import { MessageInput } from './chat/MessageInput'
import { NewTaskBar } from './chat/NewTaskBar'
import { QuickActionsBar } from './chat/QuickActionsBar'
import { SlashCommandMenu, type SlashCommand } from './chat/SlashCommandMenu'
import { SessionTabs, type SessionTabId } from './chat/SessionTabs'
import { DiffTab } from './chat/DiffTab'
import { ScreenshotsTab } from './chat/ScreenshotsTab'
import { PrPreviewCard } from './components/PrPreviewCard'
import { SessionList } from './components/SessionList'
import { UniverseCanvas } from './components/UniverseCanvas'
import { WorktreeHeader } from './components/WorktreeHeader'
import { hasFeature } from './api/features'
import type { ConnectionStore } from './state/types'
import { confirm } from './hooks/useConfirm'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
import { useMediaQuery } from './hooks/useMediaQuery'
import { currentRoute } from './routing/current'
import { VariantGroupView } from './groups/VariantGroupView'
import type { ApiSession, MinionCommand, QuickAction } from './api/types'

export type ViewMode = 'list' | 'canvas'

const showSettings = signal(false)
const showDrawer = signal(false)
export const viewMode = signal<ViewMode>('list')

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const tabClass = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
    }`
  return (
    <div
      class="inline-flex rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden"
      role="tablist"
      data-testid="view-toggle"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'list'}
        onClick={() => onChange('list')}
        class={tabClass(mode === 'list')}
        data-testid="view-toggle-list"
      >
        List
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'canvas'}
        onClick={() => onChange('canvas')}
        class={`${tabClass(mode === 'canvas')} border-l border-slate-300 dark:border-slate-600`}
        data-testid="view-toggle-canvas"
      >
        Canvas
      </button>
    </div>
  )
}

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

function statusDot(status: ApiSession['status']): string {
  if (status === 'running') return 'bg-blue-500 animate-pulse'
  if (status === 'completed') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  return 'bg-slate-400'
}

function ChatPane({
  session,
  store,
  onSend,
  onCommand,
}: {
  session: ApiSession
  store: ConnectionStore
  onSend: (text: string, sessionId: string) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<'stop' | 'close' | null>(null)
  const [activeTab, setActiveTab] = useState<SessionTabId>('chat')
  const handleSend = (t: string) => onSend(t, session.id)
  const handleQuickAction = (action: QuickAction) => onSend(action.message, session.id)

  const handleSlashCommand = async (fullText: string, cmd: SlashCommand) => {
    if (cmd.destructive) {
      const ok = await confirm({
        title: `Run ${cmd.cmd}?`,
        message: cmd.hint,
        destructive: true,
        confirmLabel: cmd.cmd,
      })
      if (!ok) return
    }
    await onSend(fullText, session.id)
    setText('')
  }

  const handleStop = async () => {
    const ok = await confirm({
      title: `Stop ${session.slug}?`,
      message: 'Interrupts the running session. You can continue it later.',
      destructive: true,
      confirmLabel: 'Stop',
    })
    if (!ok) return
    setPending('stop')
    try {
      await onCommand({ action: 'stop', sessionId: session.id })
    } finally {
      setPending(null)
    }
  }

  const handleClose = async () => {
    const ok = await confirm({
      title: `Close ${session.slug}?`,
      message: 'Closes this session permanently. Conversation history stays, but you cannot resume it.',
      destructive: true,
      confirmLabel: 'Close',
    })
    if (!ok) return
    setPending('close')
    try {
      await onCommand({ action: 'close', sessionId: session.id })
    } finally {
      setPending(null)
    }
  }

  const stoppable = session.status === 'running' || session.status === 'pending'
  const closable = session.status !== 'completed' && session.status !== 'failed'

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-800">
      <header class="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <span class={`inline-block h-2 w-2 rounded-full ${statusDot(session.status)}`} />
        <span class="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{session.slug}</span>
        <span class="text-xs text-slate-500 dark:text-slate-400">{session.status}</span>
        <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 ml-2">
          {session.mode}
        </span>
        {session.prUrl && (
          <a
            href={session.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs underline text-indigo-600 dark:text-indigo-400 ml-2"
          >
            PR
          </a>
        )}
        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={!stoppable || pending !== null}
            title={stoppable ? 'Stop this session' : 'Session is not running'}
            class="rounded-md border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="chat-stop-btn"
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={!closable || pending !== null}
            title={closable ? 'Close this session permanently' : 'Session is already terminal'}
            class="rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="chat-close-btn"
          >
            {pending === 'close' ? 'Closing…' : 'Close'}
          </button>
        </div>
      </header>
      <WorktreeHeader session={session} store={store} />
      <SessionTabs
        tabs={[
          { id: 'chat', label: 'Chat', available: true },
          { id: 'diff', label: 'Diff', available: hasFeature(store, 'diff-viewer') },
          { id: 'screenshots', label: 'Screenshots', available: hasFeature(store, 'screenshots-http') },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      >
        {activeTab === 'chat' && (
          <>
            {session.prUrl && hasFeature(store, 'pr-preview') && (
              <PrPreviewCard
                sessionId={session.id}
                prUrl={session.prUrl}
                client={store.client}
              />
            )}
            <ConversationView messages={session.conversation} />
            <div class="shrink-0 border-t border-slate-200 dark:border-slate-700">
              <QuickActionsBar actions={session.quickActions} onAction={handleQuickAction} />
              <SlashCommandMenu session={session} context={text} onCommand={handleSlashCommand} />
              <MessageInput session={session} value={text} onValueChange={setText} onSend={handleSend} />
            </div>
          </>
        )}
        {activeTab === 'diff' && (
          <DiffTab
            sessionId={session.id}
            sessionUpdatedAt={session.updatedAt}
            client={store.client}
          />
        )}
        {activeTab === 'screenshots' && (
          <ScreenshotsTab
            sessionId={session.id}
            sessionUpdatedAt={session.updatedAt}
            client={store.client}
          />
        )}
      </SessionTabs>
    </div>
  )
}

function EmptyPane() {
  return (
    <div class="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900">
      <div class="text-center text-sm text-slate-500 dark:text-slate-400">
        Select a session on the left, or start a new one with the task bar above.
      </div>
    </div>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const conn = connections.value.find((c) => c.id === id)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const isOnline = useOnlineStatus()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const mode = viewMode.value
  const route = currentRoute.value

  useEffect(() => {
    const color = conn?.color ?? '#3b82f6'
    document.documentElement.style.setProperty('--accent', color)
  }, [conn?.color])

  useEffect(() => {
    if (route.name !== 'session') return
    const match = store?.sessions.value.find((s) => s.slug === route.sessionSlug)
    if (match && match.id !== sessionId) setSessionId(match.id)
  }, [route, store, sessionId])

  const handleCanvasSendReply = useCallback(
    async (sid: string, message: string) => {
      if (!store) return
      setIsActionLoading(true)
      try {
        await store.client.sendMessage(message, sid)
      } finally {
        setIsActionLoading(false)
      }
    },
    [store]
  )

  const handleCanvasStop = useCallback(
    async (sid: string) => {
      if (!store) return
      setIsActionLoading(true)
      try {
        await store.sendCommand({ action: 'stop', sessionId: sid })
      } finally {
        setIsActionLoading(false)
      }
    },
    [store]
  )

  const handleCanvasClose = useCallback(
    async (sid: string) => {
      if (!store) return
      setIsActionLoading(true)
      try {
        await store.sendCommand({ action: 'close', sessionId: sid })
      } finally {
        setIsActionLoading(false)
      }
    },
    [store]
  )

  const handleOpenChat = useCallback((sid: string) => {
    setSessionId(sid)
    viewMode.value = 'list'
  }, [])

  if (!store || !conn) return null

  const sessions = store.sessions.value
  const dags = store.dags.value
  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null
  const isGroupRoute = route.name === 'group'

  const attentionCount = sessions.reduce((n, s) => (s.needsAttention ? n + 1 : n), 0)

  const handleSendMessage = async (text: string, sid: string) => {
    await store.client.sendMessage(text, sid)
  }

  const handleCommand = async (cmd: MinionCommand) => {
    await store.sendCommand(cmd)
  }

  const showOfflineBanner = !isOnline.value && store.stale.value

  const canvasProps = {
    sessions,
    dags,
    onSendReply: handleCanvasSendReply,
    onStopMinion: handleCanvasStop,
    onCloseSession: handleCanvasClose,
    onOpenThread: () => {},
    onOpenChat: handleOpenChat,
    isActionLoading,
    accentColor: conn.color,
  }

  return (
    <div class="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {showOfflineBanner && (
        <div class="flex items-center justify-center px-4 py-1.5 bg-amber-500 text-amber-950 text-xs font-medium shrink-0" data-testid="offline-banner">
          Offline — showing last snapshot
        </div>
      )}
      <header class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <ConnectionPicker
          onManage={() => { showDrawer.value = true }}
          activeCounts={{ sessions: sessions.length, attention: attentionCount }}
        />
        <ConnectionStatusBadge status={store.status.value} />
        <div class="ml-auto flex items-center gap-2">
          <ViewToggle mode={mode} onChange={(m) => { viewMode.value = m }} />
          <button
            type="button"
            onClick={() => void store.refresh()}
            class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            title="Refetch sessions and DAGs from the minion"
            data-testid="header-refresh-btn"
          >
            Refresh
          </button>
        </div>
      </header>
      {store.error.value && (
        <div class="flex items-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 shrink-0">
          <span class="flex-1">{store.error.value}</span>
          <button onClick={() => void store.refresh()} class="text-xs font-medium underline">Retry</button>
        </div>
      )}
      <NewTaskBar store={store} />
      {isGroupRoute ? (
        <VariantGroupView store={store} groupId={route.groupId} />
      ) : isDesktop.value ? (
        mode === 'canvas' ? (
          <div class="flex flex-1 min-h-0" data-testid="canvas-pane">
            <UniverseCanvas {...canvasProps} />
          </div>
        ) : (
          <div class="flex flex-1 min-h-0">
            <aside class="w-72 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-y-auto shrink-0">
              <SessionList
                sessions={sessions}
                dags={dags}
                activeSessionId={sessionId}
                onSelect={setSessionId}
              />
            </aside>
            {selected ? (
              <ChatPane session={selected} store={store} onSend={handleSendMessage} onCommand={handleCommand} />
            ) : (
              <EmptyPane />
            )}
          </div>
        )
      ) : (
        <div class="flex flex-col flex-1 min-h-0">
          <div class="max-h-[45vh] overflow-y-auto border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0">
            <SessionList
              sessions={sessions}
              dags={dags}
              activeSessionId={sessionId}
              onSelect={setSessionId}
            />
          </div>
          {selected ? (
            <ChatPane session={selected} store={store} onSend={handleSendMessage} onCommand={handleCommand} />
          ) : (
            <EmptyPane />
          )}
        </div>
      )}
      {!isDesktop.value && mode === 'canvas' && !isGroupRoute && (
        <div
          class="fixed inset-0 z-40 bg-slate-50 dark:bg-slate-900 flex flex-col"
          data-testid="canvas-mobile-modal"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
            <span class="text-sm font-medium text-slate-900 dark:text-slate-100">Canvas</span>
            <button
              type="button"
              onClick={() => { viewMode.value = 'list' }}
              class="ml-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid="canvas-mobile-close"
              aria-label="Close canvas"
            >
              Close
            </button>
          </div>
          <div class="flex-1 min-h-0">
            <UniverseCanvas {...canvasProps} />
          </div>
        </div>
      )}
      {showDrawer.value && (
        <ConnectionsDrawer onClose={() => { showDrawer.value = false }} />
      )}
    </div>
  )
}

function PwaController() {
  const { updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_, registration) {
      if (registration) {
        setInterval(() => { void registration.update() }, 60_000)
      }
    },
    onNeedRefresh() {
      void updateServiceWorker(true)
    },
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
