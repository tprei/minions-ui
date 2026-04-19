import { signal } from '@preact/signals'
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
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
import { AttentionBar, filterSessionsByReason } from './components/AttentionBar'
import { UniverseCanvas } from './components/UniverseCanvas'
import { hasFeature } from './api/features'
import type { ConnectionStore } from './state/types'
import { confirm } from './hooks/useConfirm'
import { ConfirmRoot } from './hooks/useConfirm'
import { InstallPrompt } from './pwa/InstallPrompt'
import { useOnlineStatus } from './pwa/useOnlineStatus'
import { useMediaQuery } from './hooks/useMediaQuery'
import { WorktreeHeader } from './components/WorktreeHeader'
import { DagStatusPanel } from './chat/DagStatusPanel'
import { ThemeToggle } from './chat/ThemeToggle'
import { ResizeHandle } from './chat/ResizeHandle'
import { useResizable } from './hooks/useResizable'
import { buildSessionGroups, type SessionGroup } from './state/hierarchy'
import type { ApiDagGraph } from './api/types'
import { currentRoute } from './routing/current'
import { VariantGroupView } from './groups/VariantGroupView'
import type { ApiSession, AttentionReason, MinionCommand, QuickAction } from './api/types'

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

type SessionItemKind = 'parent' | 'child' | 'variant' | undefined

function SessionItem({
  session,
  active,
  onSelect,
  indent = 0,
  kind,
}: {
  session: ApiSession
  active: boolean
  onSelect: () => void
  indent?: number
  kind?: SessionItemKind
}) {
  const preview = session.conversation.length > 0
    ? session.conversation[session.conversation.length - 1].text.slice(0, 60)
    : session.command.slice(0, 60)
  const baseClasses = 'w-full text-left px-3 py-2 rounded-md border transition-colors flex flex-col gap-1'
  const active_ = active
    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-400/60 dark:ring-indigo-500/50'
    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
  const marginLeft = indent > 0 ? `${indent * 16}px` : undefined
  const borderLeft = indent > 0 ? { borderLeft: '2px solid rgb(148 163 184 / 0.35)' } : undefined
  const flash = useFlashOnChange(session)
  const combinedFlash = flash ?? (active ? 'focus' : undefined)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const node = rowRef.current
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }, [active, session.id])
  return (
    <div
      ref={rowRef}
      style={{ marginLeft, ...borderLeft }}
      data-flash={combinedFlash ?? undefined}
      data-session-id={session.id}
      data-testid={`session-row-${session.id}`}
    >
      <button
        class={`${baseClasses} ${active_}`}
        onClick={onSelect}
        data-testid={`session-item-${session.id}`}
      >
        <div class="flex items-center gap-2">
          <span class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot(session.status)}`} />
          {kind && <KindBadge kind={kind} />}
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

function KindBadge({ kind }: { kind: NonNullable<SessionItemKind> }) {
  const cfg = {
    parent: { label: 'P', tone: 'bg-indigo-600 text-white dark:bg-indigo-500', title: 'DAG / split parent' },
    child: { label: 'C', tone: 'bg-sky-500 text-white dark:bg-sky-400 dark:text-slate-900', title: 'Child of a DAG / split parent' },
    variant: { label: 'V', tone: 'bg-fuchsia-500 text-white dark:bg-fuchsia-400 dark:text-slate-900', title: 'Variant session' },
  }[kind]
  return (
    <span
      class={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold ${cfg.tone}`}
      title={cfg.title}
      aria-label={cfg.title}
      data-testid={`kind-badge-${kind}`}
    >
      {cfg.label}
    </span>
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
  // Map every session id to its kind (parent / child / variant) so the
  // horizontal mobile strip can render the same P / C / V badges as the
  // vertical desktop sidebar. Undefined for standalone sessions.
  const kindById = useMemo(() => {
    const m = new Map<string, NonNullable<SessionItemKind>>()
    for (const g of groups) {
      if (g.kind === 'dag') {
        if (g.parent) m.set(g.parent.id, 'parent')
        for (const c of g.children) m.set(c.id, 'child')
      } else if (g.kind === 'parent-child') {
        m.set(g.parent.id, 'parent')
        for (const c of g.children) m.set(c.id, 'child')
      } else if (g.kind === 'variant') {
        for (const s of g.sessions) m.set(s.id, 'variant')
      }
    }
    return m
  }, [groups])

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
              kind={kindById.get(s.id)}
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
              kind="parent"
            />
          )}
          {group.children.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
              indent={1}
              kind="child"
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
            kind="parent"
          />
          {group.children.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={activeSessionId === s.id}
              onSelect={() => onSelect(s.id)}
              indent={1}
              kind="child"
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
              kind="variant"
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
  onNavigate,
}: {
  session: ApiSession
  store: ConnectionStore
  onSend: (text: string, sessionId: string) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
  onNavigate?: (sessionId: string) => void
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
      <DagStatusPanel session={session} store={store} onSelect={onNavigate} />
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
  onSend: (text: string, sid: string) => Promise<void>
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

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('minions-ui:mobile-strip-collapsed', String(next)) } catch { /* ignore */ }
  }

  // Auto-expand when the active session changes so the user can actually see
  // the focus-pulse + horizontal scroll-into-view. The preference is not
  // persisted on this code path — manual collapses still stick.
  useEffect(() => {
    if (!activeSessionId) return
    if (collapsed) setCollapsed(false)
    // Intentionally not persisting here; user's explicit collapse wins on next
    // navigation if they toggle again.
  }, [activeSessionId])

  if (sessions.length === 0) {
    return (
      <div class="text-xs text-slate-500 dark:text-slate-400 p-3 italic">
        No sessions yet.
      </div>
    )
  }

  if (collapsed) {
    const activeSlug = sessions.find((s) => s.id === activeSessionId)?.slug
    return (
      <button
        type="button"
        onClick={toggle}
        class="w-full flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left"
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
    )
  }

  return (
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
        class="absolute right-1.5 top-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-1.5 text-[10px] font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
        title="Collapse the session strip"
        aria-label="Collapse session strip"
        data-testid="mobile-strip-collapse"
      >
        ▴
      </button>
    </div>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const conn = connections.value.find((c) => c.id === id)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [attentionFilter, setAttentionFilter] = useState<AttentionReason | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const isOnline = useOnlineStatus()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const route = currentRoute.value
  const mode = viewMode.value

  useEffect(() => {
    const color = conn?.color ?? '#3b82f6'
    document.documentElement.style.setProperty('--accent', color)
  }, [conn?.color])

  useEffect(() => {
    if (route.name !== 'session') return
    const match = store?.sessions.value.find((s) => s.slug === route.sessionSlug)
    if (match && match.id !== sessionId) setSessionId(match.id)
  }, [route, store, sessionId])

  useEffect(() => {
    setAttentionFilter(null)
  }, [id])

  const sessions = store?.sessions.value ?? []
  const dags = store?.dags.value ?? []
  const visibleSessions = useMemo(
    () => filterSessionsByReason(sessions, attentionFilter),
    [sessions, attentionFilter],
  )

  const handleSendMessage = useCallback(
    async (text: string, sid: string) => {
      if (!store) return
      await store.client.sendMessage(text, sid)
    },
    [store]
  )

  const handleCommand = useCallback(
    async (cmd: MinionCommand) => {
      if (!store) return
      await store.sendCommand(cmd)
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

  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null
  const isGroupRoute = route.name === 'group'

  const handleAttentionSelect = (
    reason: AttentionReason | null,
    firstMatchId: string | null,
  ) => {
    setAttentionFilter(reason)
    if (firstMatchId !== null) setSessionId(firstMatchId)
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
    <div class="flex flex-col h-[100dvh] bg-slate-50 dark:bg-slate-900">
      {showOfflineBanner && (
        <div class="flex items-center justify-center px-4 py-1.5 bg-amber-500 text-amber-950 text-xs font-medium shrink-0" data-testid="offline-banner">
          Offline — showing last snapshot
        </div>
      )}
      <header class="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <ConnectionPicker onManage={() => { showDrawer.value = true }} />
        <ConnectionStatusBadge status={store.status.value} />
        <div class="ml-auto flex items-center gap-1.5">
          <ViewToggle mode={mode} onChange={(m) => { viewMode.value = m }} />
          <ThemeToggle />
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
          <DesktopBody
            sessions={sessions}
            visibleSessions={visibleSessions}
            dags={store.dags.value}
            sessionId={sessionId}
            setSessionId={setSessionId}
            selected={selected}
            store={store}
            onSend={handleSendMessage}
            onCommand={handleCommand}
            attentionFilter={attentionFilter}
            onAttentionSelect={handleAttentionSelect}
          />
        )
      ) : (
        <div class="flex flex-col flex-1 min-h-0">
          <AttentionBar
            sessions={sessions}
            filter={attentionFilter}
            onSelect={handleAttentionSelect}
          />
          <MobileSessionStrip
            sessions={visibleSessions}
            dags={store.dags.value}
            activeSessionId={sessionId}
            onSelect={setSessionId}
          />
          {selected ? (
            <ChatPane
              key={selected.id}
              session={selected}
              store={store}
              onSend={handleSendMessage}
              onCommand={handleCommand}
              onNavigate={setSessionId}
            />
          ) : (
            <EmptyPane />
          )}
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
