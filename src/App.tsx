import { signal } from '@preact/signals'
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
import { useRegisterSW } from 'virtual:pwa-register/preact'
import { connections, activeId, getActiveStore } from './connections/store'
import { ConnectionSettings } from './connections/ConnectionSettings'
import { ConnectionPicker } from './connections/ConnectionPicker'
import { ConnectionsDrawer } from './connections/ConnectionsDrawer'
import { ResourceChip } from './components/ResourceChip'
import { RunningBadge } from './components/RunningBadge'
import { countRunning } from './state/running'
import { RuntimeConfigDrawer, type RuntimeTab } from './settings/RuntimeConfigDrawer'
import { Transcript, TranscriptUpgradeNotice } from './chat/transcript'
import { MessageInput } from './chat/MessageInput'
import { NewTaskBar } from './chat/NewTaskBar'
import { QuickActionsBar } from './chat/QuickActionsBar'
import { SlashCommandMenu } from './chat/SlashCommandMenu'
import { SessionTabs, type SessionTabId } from './chat/SessionTabs'
import { DiffTab } from './chat/DiffTab'
import { ScreenshotsTab } from './chat/ScreenshotsTab'
import { CheckpointsTab } from './chat/CheckpointsTab'
import { PrPreviewCard } from './components/PrPreviewCard'
import { AttentionBar, filterSessionsByReason } from './components/AttentionBar'
import { UniverseCanvas } from './components/UniverseCanvas'
import { SessionLogsPopup } from './components/SessionLogsPopup'
import { ShipPipelineView } from './components/ShipPipeline'
import { hasFeature } from './api/features'
import type { ConnectionStore } from './state/types'
import { confirm } from './hooks/useConfirm'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
import { useMediaQuery } from './hooks/useMediaQuery'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { WorktreeHeader } from './components/WorktreeHeader'
import { DagStatusPanel } from './chat/DagStatusPanel'
import { ThemeToggle } from './chat/ThemeToggle'
import { ResizeHandle } from './chat/ResizeHandle'
import { useResizable } from './hooks/useResizable'
import { SessionList, statusDot } from './components/SessionList'
import type { ApiDagGraph } from './api/types'
import { currentRoute } from './routing/current'
import { formatRoute } from './routing/route'
import { VariantGroupView } from './groups/VariantGroupView'
import type { ApiSession, AttentionReason, MinionCommand, QuickAction } from './api/types'
import { HeaderMenu } from './components/HeaderMenu'
import { MemoryDrawer } from './components/MemoryDrawer'

export type ViewMode = 'list' | 'canvas' | 'ship'

const showSettings = signal(false)
const showDrawer = signal(false)
const showRuntime = signal<RuntimeTab | null>(null)
const showMemory = signal(false)
export const viewMode = signal<ViewMode>('list')

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const tabClass = (active: boolean) =>
    `px-1.5 sm:px-2.5 py-1 text-xs font-medium transition-colors ${
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
        aria-label="List"
        onClick={() => onChange('list')}
        class={tabClass(mode === 'list')}
        data-testid="view-toggle-list"
      >
        <span class="sm:hidden" aria-hidden="true">☰</span>
        <span class="hidden sm:inline">List</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'canvas'}
        aria-label="Canvas"
        onClick={() => onChange('canvas')}
        class={`${tabClass(mode === 'canvas')} border-l border-slate-300 dark:border-slate-600`}
        data-testid="view-toggle-canvas"
      >
        <span class="sm:hidden" aria-hidden="true">◎</span>
        <span class="hidden sm:inline">Canvas</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'ship'}
        aria-label="Ship"
        onClick={() => onChange('ship')}
        class={`${tabClass(mode === 'ship')} border-l border-slate-300 dark:border-slate-600`}
        data-testid="view-toggle-ship"
      >
        <span class="sm:hidden" aria-hidden="true">🚀</span>
        <span class="hidden sm:inline">Ship</span>
      </button>
    </div>
  )
}

function ConnectionStatusBadge({
  status,
  reconnectAt,
}: {
  status: string
  reconnectAt?: number | null
}) {
  const color =
    status === 'live'
      ? 'bg-green-500'
      : status === 'retrying'
        ? 'bg-yellow-500'
        : status === 'connecting'
          ? 'bg-blue-500'
          : 'bg-slate-400'

  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (status !== 'retrying' || !reconnectAt) {
      setSeconds(null)
      return
    }
    const tick = () => {
      const ms = reconnectAt - Date.now()
      setSeconds(ms > 0 ? Math.ceil(ms / 1000) : 0)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [status, reconnectAt])

  const label =
    status === 'retrying' && seconds !== null
      ? `retrying in ${seconds}s`
      : status

  return (
    <span
      class="flex items-center gap-1 sm:gap-1.5 text-xs text-slate-600 dark:text-slate-400 min-w-0 shrink"
      data-testid="connection-status-badge"
    >
      <span class={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span class="truncate" data-testid="connection-status-label">{label}</span>
    </span>
  )
}

function ChatPane({
  session,
  store,
  onSend,
  onCommand,
  onNavigate,
}: {
  session: ApiSession
  store: ConnectionStore
  onSend: (text: string, sessionId: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
  onNavigate?: (sessionId: string) => void
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<'stop' | 'close' | null>(null)
  const [activeTab, setActiveTab] = useState<SessionTabId>('chat')
  const isDesktopPane = useMediaQuery('(min-width: 768px)')
  const [fullscreen, setFullscreen] = useState<boolean>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('minions-ui:chat-fullscreen') === 'true',
  )
  const toggleFullscreen = () => {
    const next = !fullscreen
    setFullscreen(next)
    try { localStorage.setItem('minions-ui:chat-fullscreen', String(next)) } catch { /* ignore */ }
  }
  const handleSend = (t: string, images?: Array<{ mediaType: string; dataBase64: string }>) => onSend(t, session.id, images)
  const handleQuickAction = (action: QuickAction) => onSend(action.message, session.id)
  const handleShipAdvance = async (to: import('./api/types').ShipStage) => {
    await onCommand({ action: 'ship_advance', sessionId: session.id, to })
  }

  const handlePrefillCommand = (fullText: string) => {
    setText(fullText)
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

  const handleLand = async (dagId: string, nodeId: string): Promise<void> => {
    await onCommand({ action: 'land', dagId, nodeId })
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
  const mobileFullscreen = !isDesktopPane.value && fullscreen
  const rootClass = mobileFullscreen
    ? 'fixed inset-0 z-40 flex flex-col bg-white dark:bg-slate-800'
    : 'flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-800'
  const statusTone =
    session.status === 'running' || session.status === 'pending'
      ? 'text-blue-700 dark:text-blue-300 font-semibold'
      : session.status === 'failed'
        ? 'text-red-700 dark:text-red-300 font-semibold'
        : session.status === 'completed'
          ? 'text-green-700 dark:text-green-300'
          : 'text-slate-500 dark:text-slate-400'

  const parentSession = useMemo(() => {
    for (const dag of store.dags.value) {
      for (const node of Object.values(dag.nodes)) {
        if (node.session?.id === session.id) {
          for (const s of store.sessions.value) {
            if (s.id === dag.rootTaskId) return s
          }
          return null
        }
      }
    }
    return null
  }, [session.id, store.dags.value, store.sessions.value])

  return (
    <div class={rootClass} data-testid="chat-pane" data-fullscreen={mobileFullscreen ? 'true' : 'false'}>
      <header class="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        {parentSession && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate(parentSession.id)}
            class="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            title={`Back to parent: ${parentSession.slug}`}
            data-testid="chat-pane-parent-btn"
          >
            ↑ {parentSession.slug}
          </button>
        )}
        <span class={`inline-block h-2 w-2 rounded-full ${statusDot(session.status)}`} />
        <span class="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{session.slug}</span>
        <span class={`text-xs ${statusTone}`} data-testid="chat-pane-status">{session.status}</span>
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
          {!isDesktopPane.value && (
            <button
              type="button"
              onClick={toggleFullscreen}
              title={fullscreen ? 'Exit full screen' : 'Expand chat to full screen'}
              aria-label={fullscreen ? 'Exit full screen' : 'Expand chat to full screen'}
              class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid="chat-fullscreen-btn"
            >
              {fullscreen ? 'Collapse' : 'Expand'}
            </button>
          )}
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
            disabled={pending !== null}
            title="Close this session permanently"
            class="rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="chat-close-btn"
          >
            {pending === 'close' ? 'Closing…' : 'Close'}
          </button>
        </div>
      </header>
      <WorktreeHeader session={session} store={store} />
      <DagStatusPanel session={session} store={store} onSelect={onNavigate} onLand={handleLand} />
      <SessionTabs
        tabs={[
          { id: 'chat', label: 'Chat', available: true },
          { id: 'diff', label: 'Diff', available: hasFeature(store, 'diff') },
          { id: 'screenshots', label: 'Screenshots', available: hasFeature(store, 'screenshots') },
          { id: 'checkpoints', label: 'Checkpoints', available: hasFeature(store, 'session-checkpoints') },
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
                readinessAvailable={hasFeature(store, 'merge-readiness')}
              />
            )}
            {hasFeature(store, 'transcript') ? (
              <TranscriptPane store={store} sessionId={session.id} />
            ) : (
              <TranscriptUpgradeNotice store={store} />
            )}
            <div class="shrink-0 border-t border-slate-200 dark:border-slate-700">
              <QuickActionsBar session={session} onAction={handleQuickAction} onShipAdvance={handleShipAdvance} />
              <SlashCommandMenu session={session} context={text} onPrefill={handlePrefillCommand} />
              <MessageInput session={session} store={store} value={text} onValueChange={setText} onSend={handleSend} />
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
        {activeTab === 'checkpoints' && (
          <CheckpointsTab
            session={session}
            sessionUpdatedAt={session.updatedAt}
            client={store.client}
            onRestored={store.applySessionCreated}
          />
        )}
      </SessionTabs>
    </div>
  )
}

function TranscriptPane({ store, sessionId }: { store: ConnectionStore; sessionId: string }) {
  const transcript = store.getTranscript(sessionId)
  if (!transcript) {
    return (
      <div class="flex-1 flex items-center justify-center px-4 py-8 bg-slate-50 dark:bg-slate-900">
        <div class="text-xs text-slate-500 dark:text-slate-400 italic">
          Transcript unavailable for this session.
        </div>
      </div>
    )
  }
  return <Transcript store={transcript} />
}

function EmptyPane() {
  return (
    <div class="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900">
      <div class="text-center flex flex-col items-center gap-3">
        <img
          src="/minion.svg"
          alt=""
          aria-hidden="true"
          class="w-16 h-16 opacity-20 dark:opacity-30 dark:invert"
        />
        <div class="text-sm text-slate-500 dark:text-slate-400">
          Select a session on the left, or start a new one with the task bar above.
        </div>
      </div>
    </div>
  )
}

function DesktopBody({
  sessions,
  visibleSessions,
  dags,
  sessionId,
  setSessionId,
  selected,
  store,
  onSend,
  onCommand,
  attentionFilter,
  onAttentionSelect,
}: {
  sessions: ApiSession[]
  visibleSessions: ApiSession[]
  dags: ApiDagGraph[]
  sessionId: string | null
  setSessionId: (id: string) => void
  selected: ApiSession | null
  store: ConnectionStore
  onSend: (text: string, sid: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
  attentionFilter: AttentionReason | null
  onAttentionSelect: (reason: AttentionReason | null, firstMatchId: string | null) => void
}) {
  const { width, onHandleDown, reset } = useResizable({
    storageKey: 'minions-ui:sidebar-width',
    defaultWidth: 288,
    min: 200,
    max: 520,
  })
  const asideRef = useRef<HTMLDivElement>(null)

  // Scroll the active session row into view when it changes. Combined with the
  // focus-pulse animation on the active item, this makes cross-navigation
  // (e.g. clicking a child in DagStatusPanel) visually obvious.
  useEffect(() => {
    if (!sessionId) return
    const aside = asideRef.current
    if (!aside) return
    const row = aside.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`)
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [sessionId])

  return (
    <div class="flex flex-1 min-h-0">
      <aside
        ref={asideRef}
        class="border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-y-auto shrink-0"
        style={{ width: `${width}px` }}
        data-testid="desktop-sidebar"
      >
        <AttentionBar
          sessions={sessions}
          filter={attentionFilter}
          onSelect={onAttentionSelect}
        />
        <SessionList
          sessions={visibleSessions}
          dags={dags}
          activeSessionId={sessionId}
          onSelect={setSessionId}
          orientation="vertical"
        />
      </aside>
      <ResizeHandle onMouseDown={onHandleDown} onDoubleClick={reset} />
      {selected ? (
        <ChatPane
          key={selected.id}
          session={selected}
          store={store}
          onSend={onSend}
          onCommand={onCommand}
          onNavigate={setSessionId}
        />
      ) : (
        <EmptyPane />
      )}
    </div>
  )
}

function MobileSessionStrip({
  sessions,
  dags,
  activeSessionId,
  onSelect,
}: {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  activeSessionId: string | null
  onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('minions-ui:mobile-strip-collapsed') === 'true',
  )
  const wasCollapsedRef = useRef(collapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('minions-ui:mobile-strip-collapsed', String(next)) } catch { /* ignore */ }
  }

  // Auto-expand when the active session changes so the user can actually see
  // the focus-pulse + horizontal scroll-into-view. Delay the scroll slightly
  // when transitioning from collapsed to give the layout time to settle.
  useEffect(() => {
    if (!activeSessionId) return
    wasCollapsedRef.current = collapsed
    if (collapsed) setCollapsed(false)
    // Intentionally not persisting here; user's explicit collapse wins on next
    // navigation if they toggle again.
  }, [activeSessionId, collapsed])

  if (sessions.length === 0) {
    return (
      <div class="text-xs text-slate-500 dark:text-slate-400 p-3 italic">
        No sessions yet.
      </div>
    )
  }

  const activeSlug = sessions.find((s) => s.id === activeSessionId)?.slug

  return (
    <div class="relative border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          class="w-full flex items-center gap-2 px-3 py-2 text-left"
          data-testid="mobile-strip-expand"
        >
          <span class="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Sessions</span>
          <span class="text-xs font-mono text-slate-600 dark:text-slate-300">{sessions.length}</span>
          {activeSlug && (
            <>
              <span class="text-slate-400 dark:text-slate-500">·</span>
              <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{activeSlug}</span>
            </>
          )}
          <span class="ml-auto text-[10px] text-slate-500 dark:text-slate-400">expand ▾</span>
        </button>
      ) : (
        <div class="relative">
          <SessionList
            sessions={sessions}
            dags={dags}
            activeSessionId={activeSessionId}
            onSelect={onSelect}
            orientation="horizontal"
          />
          <button
            type="button"
            onClick={toggle}
            class="absolute right-1.5 top-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-1.5 text-[10px] font-medium hover:bg-slate-100 dark:hover:bg-slate-700 z-10"
            title="Collapse the session strip"
            aria-label="Collapse session strip"
            data-testid="mobile-strip-collapse"
          >
            ▴
          </button>
        </div>
      )}
    </div>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const sessions = store?.sessions.value ?? []
  const dags = store?.dags.value ?? []
  const conn = connections.value.find((c) => c.id === id)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [attentionFilter, setAttentionFilter] = useState<AttentionReason | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [logsSessionId, setLogsSessionId] = useState<string | null>(null)
  const isOnline = useOnlineStatus()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const route = currentRoute.value
  const mode = viewMode.value

  useEffect(() => {
    const color = conn?.color ?? '#3b82f6'
    document.documentElement.style.setProperty('--accent', color)
  }, [conn?.color])

  const runningCount = store ? countRunning(store.sessions.value) : 0
  useEffect(() => {
    const base = 'Minions UI'
    document.title = runningCount > 0 ? `(${runningCount}) ${base}` : base
    return () => {
      document.title = base
    }
  }, [runningCount])

  useEffect(() => {
    if (route.name !== 'session') return
    const match = sessions.find((s) => s.slug === route.sessionSlug)
    if (!match) return
    setSessionId((prev) => (prev === match.id ? prev : match.id))
  }, [route, sessions])

  useEffect(() => {
    setAttentionFilter(null)
  }, [id])

  const visibleSessions = useMemo(
    () => filterSessionsByReason(sessions, attentionFilter),
    [sessions, attentionFilter],
  )

  const selectSession = useCallback(
    (sid: string) => {
      setSessionId(sid)
      const session = sessions.find((s) => s.id === sid)
      if (!session || typeof window === 'undefined') return
      const nextHash = formatRoute({ name: 'session', sessionSlug: session.slug })
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash
      }
    },
    [sessions],
  )

  const handleSendMessage = useCallback(
    async (text: string, sid: string, images?: Array<{ mediaType: string; dataBase64: string }>) => {
      if (!store) return
      await store.client.sendMessage(text, sid, images)
    },
    [store]
  )

  const handleCommand = useCallback(
    async (cmd: MinionCommand) => {
      if (!store) return
      const result = await store.sendCommand(cmd)
      if (!result.success) return
      if (cmd.action === 'close') {
        store.applySessionDeleted(cmd.sessionId)
      }
    },
    [store]
  )

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
        const result = await store.sendCommand({ action: 'close', sessionId: sid })
        if (result.success) store.applySessionDeleted(sid)
      } finally {
        setIsActionLoading(false)
      }
    },
    [store]
  )

  const handleOpenChat = useCallback((sid: string) => {
    selectSession(sid)
    viewMode.value = 'list'
  }, [selectSession])

  const handleOpenLogs = useCallback((sid: string) => {
    setLogsSessionId(sid)
  }, [])

  const handleRetryRebase = useCallback(
    async (dagId: string, nodeId: string) => {
      if (!store) return
      setIsActionLoading(true)
      try {
        await store.sendCommand({ action: 'retry_rebase', dagId, nodeId })
      } finally {
        setIsActionLoading(false)
      }
    },
    [store]
  )

  const [cleaning, setCleaning] = useState(false)
  const handleClean = useCallback(async () => {
    if (!store) return
    const ok = await confirm({
      title: 'Clean unused resources?',
      message: 'Runs /clean to prune unused worktrees, branches, and session state on the minion.',
      destructive: true,
      confirmLabel: 'Clean',
    })
    if (!ok) return
    setCleaning(true)
    try {
      await store.client.sendMessage('/clean')
    } catch (e) {
      await confirm({
        title: 'Clean failed',
        message: e instanceof Error ? e.message : 'Unknown error',
        mode: 'alert',
      })
    } finally {
      setCleaning(false)
    }
  }, [store])

  if (!store || !conn) return null

  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null
  const isGroupRoute = route.name === 'group'

  const pullToRefresh = usePullToRefresh({
    onRefresh: () => store.refresh(),
    enabled: !isDesktop.value && mode === 'list' && !isGroupRoute,
    threshold: 80,
  })

  const handleAttentionSelect = (
    reason: AttentionReason | null,
    firstMatchId: string | null,
  ) => {
    setAttentionFilter(reason)
    if (firstMatchId !== null) selectSession(firstMatchId)
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
    onViewLogs: handleOpenLogs,
    onRetryRebase: handleRetryRebase,
    isActionLoading,
    accentColor: conn.color,
  }

  return (
    <div class="flex flex-col h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-900">
      {showOfflineBanner && (
        <div class="flex items-center justify-center px-4 py-1.5 bg-amber-500 text-amber-950 text-xs font-medium shrink-0" data-testid="offline-banner">
          Offline — showing last snapshot
        </div>
      )}
      <header class="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 overflow-x-clip">
        <ConnectionPicker onManage={() => { showDrawer.value = true }} />
        <ConnectionStatusBadge status={store.status.value} reconnectAt={store.reconnectAt.value} />
        {hasFeature(store, 'resource-metrics') && (
          <ResourceChip store={store} onOpen={() => { showRuntime.value = 'resources' }} />
        )}
        <RunningBadge store={store} onSelect={handleOpenChat} />
        {isDesktop.value ? (
          <div class="ml-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
            <ViewToggle mode={mode} onChange={(m) => { viewMode.value = m }} />
            <ThemeToggle />
            {hasFeature(store, 'memory') && (
              <button
                type="button"
                onClick={() => { showMemory.value = true }}
                class="relative rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                title="Memory proposals"
                aria-label="Open memory drawer"
                data-testid="header-memory-btn"
              >
                <span aria-hidden="true">🧠</span>
                {store.memoryProposalsCount.value > 0 && (
                  <span
                    class="absolute -top-1 -right-1 rounded-full bg-indigo-600 text-white text-[10px] font-medium px-1 min-w-[16px] h-4 flex items-center justify-center"
                    data-testid="memory-proposals-badge"
                  >
                    {store.memoryProposalsCount.value}
                  </span>
                )}
              </button>
            )}
            {hasFeature(store, 'runtime-config') && (
              <button
                type="button"
                onClick={() => { showRuntime.value = 'config' }}
                class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                title="Runtime config"
                aria-label="Open runtime config"
                data-testid="header-runtime-config-btn"
              >
                <span aria-hidden="true">⚙️</span>
              </button>
            )}
            {hasFeature(store, 'messages') && (
              <button
                type="button"
                onClick={() => void handleClean()}
                disabled={cleaning}
                class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={cleaning ? 'Cleaning…' : 'Clean unused worktrees, branches, and session state'}
                aria-label={cleaning ? 'Cleaning…' : 'Clean unused worktrees, branches, and session state'}
                data-testid="header-clean-btn"
              >
                <span aria-hidden="true">🧹</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void store.refresh()}
              class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
              title="Refetch sessions and DAGs from the minion"
              aria-label="Refetch sessions and DAGs from the minion"
              data-testid="header-refresh-btn"
            >
              <span aria-hidden="true">🔄</span>
            </button>
          </div>
        ) : (
          <div class="ml-auto">
            <HeaderMenu
              onMemory={hasFeature(store, 'memory') ? () => { showMemory.value = true } : undefined}
              onRuntimeConfig={hasFeature(store, 'runtime-config') ? () => { showRuntime.value = 'config' } : undefined}
              onClean={hasFeature(store, 'messages') ? handleClean : undefined}
              onRefresh={() => void store.refresh()}
              showMemory={hasFeature(store, 'memory')}
              memoryProposalsCount={store.memoryProposalsCount.value}
              showRuntimeConfig={hasFeature(store, 'runtime-config')}
              showClean={hasFeature(store, 'messages')}
              cleaning={cleaning}
            />
          </div>
        )}
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
        ) : mode === 'ship' ? (
          <div class="flex flex-1 min-h-0" data-testid="ship-pane">
            <ShipPipelineView dags={dags} onOpenChat={handleOpenChat} />
          </div>
        ) : (
          <DesktopBody
            sessions={sessions}
            visibleSessions={visibleSessions}
            dags={store.dags.value}
            sessionId={sessionId}
            setSessionId={selectSession}
            selected={selected}
            store={store}
            onSend={handleSendMessage}
            onCommand={handleCommand}
            attentionFilter={attentionFilter}
            onAttentionSelect={handleAttentionSelect}
          />
        )
      ) : (
        <div class="flex flex-col flex-1 min-h-0 relative overflow-hidden">
          {pullToRefresh.pullDistance > 0 && (
            <div
              class="absolute top-0 left-0 right-0 flex items-center justify-center transition-opacity z-10"
              style={{
                height: `${pullToRefresh.pullDistance}px`,
                opacity: Math.min(pullToRefresh.pullDistance / 80, 1),
              }}
            >
              <div class="flex items-center justify-center bg-white dark:bg-slate-800 rounded-full w-8 h-8 shadow-md">
                <span
                  class={`text-base ${pullToRefresh.isRefreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                >
                  🔄
                </span>
              </div>
            </div>
          )}
          <div
            {...pullToRefresh.containerProps}
            class="flex flex-col flex-1 min-h-0 overflow-y-auto"
            style={{
              transform: pullToRefresh.pullDistance > 0 ? `translateY(${pullToRefresh.pullDistance}px)` : undefined,
              transition: pullToRefresh.isRefreshing || pullToRefresh.pullDistance === 0 ? 'transform 0.2s ease-out' : 'none',
            }}
          >
            <AttentionBar
              sessions={sessions}
              filter={attentionFilter}
              onSelect={handleAttentionSelect}
            />
            <MobileSessionStrip
              sessions={visibleSessions}
              dags={store.dags.value}
              activeSessionId={sessionId}
              onSelect={selectSession}
            />
            {selected ? (
              <ChatPane
                key={selected.id}
                session={selected}
                store={store}
                onSend={handleSendMessage}
                onCommand={handleCommand}
                onNavigate={selectSession}
              />
            ) : (
              <EmptyPane />
            )}
          </div>
        </div>
      )}
      {!isDesktop.value && mode === 'canvas' && (
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
      {!isDesktop.value && mode === 'ship' && (
        <div
          class="fixed inset-0 z-40 bg-slate-50 dark:bg-slate-900 flex flex-col"
          data-testid="ship-mobile-modal"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
            <span class="text-sm font-medium text-slate-900 dark:text-slate-100">Ship</span>
            <button
              type="button"
              onClick={() => { viewMode.value = 'list' }}
              class="ml-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid="ship-mobile-close"
              aria-label="Close ship view"
            >
              Close
            </button>
          </div>
          <div class="flex-1 min-h-0 flex flex-col">
            <ShipPipelineView dags={dags} onOpenChat={handleOpenChat} />
          </div>
        </div>
      )}
      {showDrawer.value && (
        <ConnectionsDrawer onClose={() => { showDrawer.value = false }} />
      )}
      {showRuntime.value !== null && (
        <RuntimeConfigDrawer
          store={store}
          initialTab={showRuntime.value}
          onClose={() => { showRuntime.value = null }}
        />
      )}
      {showMemory.value && (
        <MemoryDrawer
          store={store}
          onClose={() => { showMemory.value = false }}
        />
      )}
      {logsSessionId !== null && (() => {
        const logsSession = sessions.find((s) => s.id === logsSessionId)
        const transcript = logsSession ? store.getTranscript(logsSession.id) : null
        if (!logsSession || !transcript) return null
        return (
          <SessionLogsPopup
            sessionSlug={logsSession.slug}
            transcript={transcript}
            onClose={() => setLogsSessionId(null)}
          />
        )
      })()}
    </div>
  )
}

function PwaController() {
  const sw = useRegisterSW({
    immediate: true,
    onRegisteredSW(_, registration) {
      if (registration) {
        setInterval(() => { void registration.update() }, 60_000)
      }
    },
  })
  const [offlineReady, setOfflineReady] = (sw.offlineReady ?? [false, () => {}]) as [boolean, (value: boolean) => void]
  const [needRefresh, setNeedRefresh] = (sw.needRefresh ?? [false, () => {}]) as [boolean, (value: boolean) => void]

  if (!offlineReady && !needRefresh) return null

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <div
      class="pointer-events-none fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex items-center gap-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 shadow-lg sm:left-auto sm:right-4 sm:top-4 sm:w-[min(24rem,calc(100vw-2rem))]"
      role="status"
      data-testid="pwa-status-banner"
    >
      <span class="flex-1 text-xs font-medium text-slate-700 dark:text-slate-200">
        {needRefresh ? 'Update ready' : 'Offline ready'}
      </span>
      {needRefresh && (
        <button
          type="button"
          onClick={() => void sw.updateServiceWorker(true)}
          class="pointer-events-auto rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          data-testid="pwa-update-reload"
        >
          Reload
        </button>
      )}
      <button
        type="button"
        onClick={close}
        class="pointer-events-auto rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
        data-testid="pwa-status-dismiss"
      >
        Dismiss
      </button>
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
