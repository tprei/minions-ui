import { signal, useSignal } from '@preact/signals'
import { useState, useEffect, useMemo } from 'preact/hooks'
import { useRegisterSW } from 'virtual:pwa-register/preact'
import { connections, activeId, getActiveStore } from './connections/store'
import { route, navigate } from './routing/route'
import { ConnectionSettings } from './connections/ConnectionSettings'
import { ConnectionPicker } from './connections/ConnectionPicker'
import { ConnectionsDrawer } from './connections/ConnectionsDrawer'
import { ConversationView } from './chat/ConversationView'
import { MessageInput } from './chat/MessageInput'
import { QuickActionsBar } from './chat/QuickActionsBar'
import { SlashCommandMenu, type SlashCommand } from './chat/SlashCommandMenu'
import { confirm } from './hooks/useConfirm'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
import { useMediaQuery } from './hooks/useMediaQuery'
import type { ApiSession, MinionCommand, QuickAction, RepoEntry } from './api/types'

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

const TASK_LIKE_COMMANDS = ['/task', '/plan', '/think', '/dag', '/split', '/stack', '/ship', '/doctor']

function injectRepo(text: string, repo: string): string {
  const trimmed = text.trimStart()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) return text
  const head = trimmed.slice(0, spaceIdx)
  const rest = trimmed.slice(spaceIdx + 1)
  if (!TASK_LIKE_COMMANDS.includes(head)) return text
  const restTrimmed = rest.trimStart()
  const firstToken = restTrimmed.split(' ', 1)[0] ?? ''
  if (firstToken === repo) return `${head} ${restTrimmed}`
  return `${head} ${repo} ${restTrimmed}`
}

function NewTaskBar({
  repos,
  onSend,
}: {
  repos: RepoEntry[]
  onSend: (text: string) => Promise<void>
}) {
  const text = useSignal('')
  const sending = useSignal(false)
  const error = useSignal<string | null>(null)
  const selectedRepo = useSignal<string>(repos.length > 0 ? repos[0].alias : '')

  const submit = async () => {
    const raw = text.value.trim()
    if (!raw || sending.value) return
    const value = selectedRepo.value ? injectRepo(raw, selectedRepo.value) : raw
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
    <div class="flex flex-col gap-1 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div class="flex items-center gap-2">
        {repos.length > 0 && (
          <select
            value={selectedRepo.value}
            onChange={(e) => { selectedRepo.value = (e.currentTarget as HTMLSelectElement).value }}
            disabled={sending.value}
            title="Repo to run the task against (auto-inserted after the slash command)"
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-2 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-50"
            data-testid="new-task-repo-select"
          >
            {repos.map((r) => (
              <option key={r.alias} value={r.alias}>{r.alias}</option>
            ))}
            <option value="">(no repo)</option>
          </select>
        )}
        <input
          type="text"
          value={text.value}
          onInput={(e) => { text.value = (e.currentTarget as HTMLInputElement).value }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
          disabled={sending.value}
          placeholder="New task: /task <prompt>, /plan, /think, /dag, /split, /stack, /doctor, /ship"
          class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
        />
        <button
          onClick={() => void submit()}
          disabled={sending.value || !text.value.trim()}
          class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {sending.value ? '…' : 'Send'}
        </button>
      </div>
      {error.value && <div class="text-xs text-red-600 dark:text-red-400">{error.value}</div>}
    </div>
  )
}

function SessionItem({ session, active, onSelect }: { session: ApiSession; active: boolean; onSelect: () => void }) {
  const preview = session.conversation.length > 0
    ? session.conversation[session.conversation.length - 1].text.slice(0, 60)
    : session.command.slice(0, 60)
  const baseClasses = 'w-full text-left px-3 py-2 rounded-md border transition-colors flex flex-col gap-1'
  const active_ = active
    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700'
    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
  return (
    <button class={`${baseClasses} ${active_}`} onClick={onSelect} data-testid={`session-item-${session.id}`}>
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
  )
}

function shortRepo(repoUrl: string): string {
  const match = repoUrl.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : repoUrl
}

function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  orientation,
}: {
  sessions: ApiSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  orientation: 'vertical' | 'horizontal'
}) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [sessions]
  )
  if (sorted.length === 0) {
    return (
      <div class="text-xs text-slate-500 dark:text-slate-400 p-3 italic">
        No sessions yet. Send a /task above.
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
    <div class="flex flex-col gap-1 p-2 overflow-y-auto">
      {sorted.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          active={activeSessionId === s.id}
          onSelect={() => onSelect(s.id)}
        />
      ))}
    </div>
  )
}

function ChatPane({
  session,
  onSend,
  onCommand,
}: {
  session: ApiSession
  onSend: (text: string, sessionId: string) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<'stop' | 'close' | null>(null)
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
      <ConversationView messages={session.conversation} />
      <div class="shrink-0 border-t border-slate-200 dark:border-slate-700">
        <QuickActionsBar actions={session.quickActions} onAction={handleQuickAction} />
        <SlashCommandMenu session={session} context={text} onCommand={handleSlashCommand} />
        <MessageInput session={session} value={text} onValueChange={setText} onSend={handleSend} />
      </div>
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
  const currentRoute = route.value
  const sessionId = currentRoute.name === 'session' ? currentRoute.sessionId : null
  const selectSession = (id: string) => navigate({ name: 'session', sessionId: id })
  const isOnline = useOnlineStatus()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    const color = conn?.color ?? '#3b82f6'
    document.documentElement.style.setProperty('--accent', color)
  }, [conn?.color])

  if (!store || !conn) return null

  const sessions = store.sessions.value
  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null

  const handleSendMessage = async (text: string, sid: string) => {
    await store.client.sendMessage(text, sid)
  }

  const handleCommand = async (cmd: MinionCommand) => {
    await store.sendCommand(cmd)
  }

  const handleNewTask = async (text: string) => {
    await store.client.sendMessage(text)
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
      <NewTaskBar repos={store.version.value?.repos ?? []} onSend={handleNewTask} />
      {isDesktop.value ? (
        <div class="flex flex-1 min-h-0">
          <aside class="w-72 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-y-auto shrink-0">
            <SessionList
              sessions={sessions}
              activeSessionId={sessionId}
              onSelect={selectSession}
              orientation="vertical"
            />
          </aside>
          {selected ? (
            <ChatPane session={selected} onSend={handleSendMessage} onCommand={handleCommand} />
          ) : (
            <EmptyPane />
          )}
        </div>
      ) : (
        <div class="flex flex-col flex-1 min-h-0">
          <SessionList
            sessions={sessions}
            activeSessionId={sessionId}
            onSelect={selectSession}
            orientation="horizontal"
          />
          {selected ? (
            <ChatPane session={selected} onSend={handleSendMessage} onCommand={handleCommand} />
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
