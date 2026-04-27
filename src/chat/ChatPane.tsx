import { useState, useMemo } from 'preact/hooks'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { confirm } from '../hooks/useConfirm'
import { SessionTabs, type SessionTabId } from './SessionTabs'
import { DiffTab } from './DiffTab'
import { ScreenshotsTab } from './ScreenshotsTab'
import { CheckpointsTab } from './CheckpointsTab'
import { QuickActionsBar } from './QuickActionsBar'
import { SlashCommandMenu } from './SlashCommandMenu'
import { MessageInput } from './MessageInput'
import { DagStatusPanel } from './DagStatusPanel'
import { Transcript, TranscriptUpgradeNotice } from './transcript'
import { PrPreviewCard } from '../components/PrPreviewCard'
import { WorktreeHeader } from '../components/WorktreeHeader'
import { statusDot } from '../components/SessionList'
import { hasFeature } from '../api/features'
import type { ApiSession, MinionCommand, QuickAction } from '../api/types'
import type { ConnectionStore } from '../state/types'

interface ChatPaneProps {
  session: ApiSession
  store: ConnectionStore
  onSend: (text: string, sessionId: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
  onNavigate?: (sessionId: string) => void
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

export function ChatPane({
  session,
  store,
  onSend,
  onCommand,
  onNavigate,
}: ChatPaneProps) {
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
  const handleShipAdvance = async (to: import('../api/types').ShipStage) => {
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
      <header class="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        {parentSession && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate(parentSession.id)}
            class="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]"
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
              class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]"
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
            class="rounded-md border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            data-testid="chat-stop-btn"
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={pending !== null}
            title="Close this session permanently"
            class="rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
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
