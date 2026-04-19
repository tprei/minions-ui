import { signal } from '@preact/signals'
import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
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
import { hasFeature } from './api/features'
import type { ConnectionStore } from './state/types'
import { confirm } from './hooks/useConfirm'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
import { useMediaQuery } from './hooks/useMediaQuery'
import { WorktreeHeader } from './components/WorktreeHeader'
import { DagStatusPanel } from './chat/DagStatusPanel'
import { buildSessionGroups, type SessionGroup } from './state/hierarchy'
import type { ApiDagGraph } from './api/types'
import { currentRoute } from './routing/current'
import { VariantGroupView } from './groups/VariantGroupView'
import type { ApiSession, MinionCommand, QuickAction } from './api/types'

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

function statusDot(status: ApiSession['status']): string {
  if (status === 'running') return 'bg-blue-500 animate-pulse'
  if (status === 'completed') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  return 'bg-slate-400'
}

function useFlashOnChange(session: ApiSession): 'success' | 'fail' | 'update' | null {
  const [flash, setFlash] = useState<'success' | 'fail' | 'update' | null>(null)
  const prev = useRef({ status: session.status, updatedAt: session.updatedAt, mounted: false })

  useEffect(() => {
    const p = prev.current
    if (!p.mounted) {
      p.mounted = true
      p.status = session.status
      p.updatedAt = session.updatedAt
      return
    }
    let next: 'success' | 'fail' | 'update' | null = null
    if (p.status !== session.status) {
      if (session.status === 'completed') next = 'success'
      else if (session.status === 'failed') next = 'fail'
      else next = 'update'
    } else if (p.updatedAt !== session.updatedAt) {
      next = 'update'
    }
    p.status = session.status
    p.updatedAt = session.updatedAt
    if (!next) return
    setFlash(next)
    const timer = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(timer)
  }, [session.status, session.updatedAt])

  return flash
}

function SessionItem({
  session,
  active,
  onSelect,
  indent = 0,
}: {
  session: ApiSession
  active: boolean
  onSelect: () => void
  indent?: number
}) {
  const preview = session.conversation.length > 0
    ? session.conversation[session.conversation.length - 1].text.slice(0, 60)
    : session.command.slice(0, 60)
  const baseClasses = 'w-full text-left px-3 py-2 rounded-md border transition-colors flex flex-col gap-1'
  const active_ = active
    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700'
    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
  const marginLeft = indent > 0 ? `${indent * 16}px` : undefined
  const borderLeft = indent > 0 ? { borderLeft: '2px solid rgb(148 163 184 / 0.35)' } : undefined
  const flash = useFlashOnChange(session)
  return (
    <div style={{ marginLeft, ...borderLeft }} data-flash={flash ?? undefined} data-testid={`session-row-${session.id}`}>
      <button
        class={`${baseClasses} ${active_}`}
        onClick={onSelect}
        data-testid={`session-item-${session.id}`}
      >
        <div class="flex items-center gap-2">
          <span class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot(session.status)}`} />
          <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{session.slug}</span>
          {session.repo && (
            <span class="text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-slate-600 dark:text-slate-300 truncate">
              {shortRepo(session.repo)}
            </span>
          )}
          <span class="ml-auto text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{session.status}</span>
        </div>
        <div class="text-xs text-slate-600 dark:text-slate-400 truncate">{preview || '—'}</div>
      </button>
    </div>
  )
}

function GroupHeader({ label, count, tone = 'default' }: { label: string; count: number; tone?: 'default' | 'dag' | 'variant' }) {
  const toneClass =
    tone === 'dag'
      ? 'text-indigo-700 dark:text-indigo-300'
      : tone === 'variant'
        ? 'text-fuchsia-700 dark:text-fuchsia-300'
        : 'text-slate-500 dark:text-slate-400'
  return (
    <div class={`flex items-center gap-2 px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold ${toneClass}`}>
      <span>{label}</span>
      <span class="text-slate-400 dark:text-slate-500 font-normal">· {count}</span>
    </div>
  )
}

function dagStatusTone(status: ApiDagGraph['status']): string {
  if (status === 'running') return 'text-blue-600 dark:text-blue-400'
  if (status === 'completed') return 'text-green-600 dark:text-green-400'
  if (status === 'failed') return 'text-red-600 dark:text-red-400'
  return 'text-slate-500 dark:text-slate-400'
}

function shortRepo(repoUrl: string): string {
  const match = repoUrl.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : repoUrl
}

function SessionList({
  sessions,
  dags,
  activeSessionId,
  onSelect,
  orientation,
}: {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  orientation: 'vertical' | 'horizontal'
}) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [sessions]
  )
  const groups = useMemo(() => buildSessionGroups(sorted, dags), [sorted, dags])

  if (sorted.length === 0) {
    return (
      <div class="text-xs text-slate-500 dark:text-slate-400 p-3 italic">
        No sessions yet. Launch one from the task bar above.
      </div>
    )
  }
  if (orientation === 'horizontal') {
    return (
      <div class="flex gap-2 overflow-x-auto px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {sorted.map((s) => (
          <div key={s.id} class="min-w-[180px]">
            <SessionItem
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
            />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div class="flex flex-col overflow-y-auto" data-testid="session-list">
      {groups.map((g) => (
        <GroupView
          key={groupKey(g)}
          group={g}
          activeSessionId={activeSessionId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function groupKey(g: SessionGroup): string {
  switch (g.kind) {
    case 'dag': return `dag:${g.dag.id}`
    case 'parent-child': return `pc:${g.parent.id}`
    case 'variant': return `var:${g.groupId}`
    case 'standalone': return `s:${g.session.id}`
  }
}

function GroupView({
  group,
  activeSessionId,
  onSelect,
}: {
  group: SessionGroup
  activeSessionId: string | null
  onSelect: (id: string) => void
}) {
  if (group.kind === 'dag') {
    const dag = group.dag
    const total = Object.keys(dag.nodes).length
    return (
      <>
        <div class="flex items-center gap-2 px-3 pt-3 pb-1" data-testid={`group-dag-${dag.id}`}>
          <span class="text-[10px] uppercase tracking-wider font-semibold text-indigo-700 dark:text-indigo-300">DAG</span>
          <span class="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">{dag.id.replace(/^dag-/, '')}</span>
          <span class={`ml-auto text-[10px] font-medium ${dagStatusTone(dag.status)}`}>{dag.status} · {total}</span>
        </div>
        <div class="flex flex-col gap-1 p-2 pt-1">
          {group.parent && (
            <SessionItem
              session={group.parent}
              active={activeSessionId === group.parent.id}
              onSelect={() => onSelect(group.parent!.id)}
            />
          )}
          {group.children.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
              indent={1}
            />
          ))}
        </div>
      </>
    )
  }
  if (group.kind === 'parent-child') {
    return (
      <>
        <GroupHeader label="Parent" count={1 + group.children.length} />
        <div class="flex flex-col gap-1 p-2 pt-1">
          <SessionItem
            session={group.parent}
            active={activeSessionId === group.parent.id}
            onSelect={() => onSelect(group.parent.id)}
          />
          {group.children.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
              indent={1}
            />
          ))}
        </div>
      </>
    )
  }
  if (group.kind === 'variant') {
    return (
      <>
        <GroupHeader label={`Variants`} count={group.sessions.length} tone="variant" />
        <div class="flex flex-col gap-1 p-2 pt-1">
          {group.sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
              indent={1}
            />
          ))}
        </div>
      </>
    )
  }
  return (
    <div class="px-2 py-0.5">
      <SessionItem
        session={group.session}
        active={activeSessionId === group.session.id}
        onSelect={() => onSelect(group.session.id)}
      />
    </div>
  )
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
      <DagStatusPanel session={session} store={store} />
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
  const isOnline = useOnlineStatus()
  const isDesktop = useMediaQuery('(min-width: 768px)')
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

  if (!store || !conn) return null

  const sessions = store.sessions.value
  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null
  const isGroupRoute = route.name === 'group'

  const handleSendMessage = async (text: string, sid: string) => {
    await store.client.sendMessage(text, sid)
  }

  const handleCommand = async (cmd: MinionCommand) => {
    await store.sendCommand(cmd)
  }

  const showOfflineBanner = !isOnline.value && store.stale.value

  return (
    <div class="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {showOfflineBanner && (
        <div class="flex items-center justify-center px-4 py-1.5 bg-amber-500 text-amber-950 text-xs font-medium shrink-0" data-testid="offline-banner">
          Offline — showing last snapshot
        </div>
      )}
      <header class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <ConnectionPicker onManage={() => { showDrawer.value = true }} />
        <ConnectionStatusBadge status={store.status.value} />
        <button
          type="button"
          onClick={() => void store.refresh()}
          class="ml-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
          title="Refetch sessions and DAGs from the minion"
          data-testid="header-refresh-btn"
        >
          Refresh
        </button>
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
        <div class="flex flex-1 min-h-0">
          <aside class="w-72 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-y-auto shrink-0">
            <SessionList
              sessions={sessions}
              dags={store.dags.value}
              activeSessionId={sessionId}
              onSelect={setSessionId}
              orientation="vertical"
            />
          </aside>
          {selected ? (
            <ChatPane session={selected} store={store} onSend={handleSendMessage} onCommand={handleCommand} />
          ) : (
            <EmptyPane />
          )}
        </div>
      ) : (
        <div class="flex flex-col flex-1 min-h-0">
          <SessionList
            sessions={sessions}
            dags={store.dags.value}
            activeSessionId={sessionId}
            onSelect={setSessionId}
            orientation="horizontal"
          />
          {selected ? (
            <ChatPane session={selected} store={store} onSend={handleSendMessage} onCommand={handleCommand} />
          ) : (
            <EmptyPane />
          )}
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
