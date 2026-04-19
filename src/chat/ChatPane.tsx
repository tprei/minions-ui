import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiSession, ApiDagGraph, MinionCommand, QuickAction } from '../api/types'
import { confirm } from '../hooks/useConfirm'
import { ConversationView } from './ConversationView'
import { MessageInput } from './MessageInput'
import { QuickActionsBar } from './QuickActionsBar'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'

function statusDot(status: ApiSession['status']): string {
  if (status === 'running') return 'bg-blue-500 animate-pulse'
  if (status === 'completed') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  return 'bg-slate-400'
}

interface DagContext {
  dag: ApiDagGraph
  rootSlug: string | null
  position: number
  total: number
  dependencies: { id: string; slug: string; status: string }[]
  dependents: { id: string; slug: string; status: string }[]
}

function findDagContext(
  sessionId: string,
  dags: ApiDagGraph[],
  sessionById: Map<string, ApiSession>,
): DagContext | null {
  for (const dag of dags) {
    const node = dag.nodes[sessionId]
    if (!node) continue
    const allNodes = Object.values(dag.nodes)
    const total = allNodes.length
    const landedOrDone = allNodes.filter(
      (n) => n.status === 'landed' || n.status === 'completed',
    ).length
    const position = node.status === 'landed' || node.status === 'completed'
      ? landedOrDone
      : landedOrDone + 1
    const rootNode = dag.nodes[dag.rootTaskId]
    const rootSlug = rootNode?.slug ?? sessionById.get(dag.rootTaskId)?.slug ?? null
    const dependencies = node.dependencies
      .map((depId) => {
        const depNode = dag.nodes[depId]
        if (!depNode) return null
        return { id: depId, slug: depNode.slug, status: depNode.status }
      })
      .filter((x) => x !== null)
    const dependents = node.dependents
      .map((depId) => {
        const depNode = dag.nodes[depId]
        if (!depNode) return null
        return { id: depId, slug: depNode.slug, status: depNode.status }
      })
      .filter((x) => x !== null)
    return { dag, rootSlug, position, total, dependencies, dependents }
  }
  return null
}

function dagNodeDot(status: string): string {
  if (status === 'running') return 'bg-blue-500 animate-pulse'
  if (status === 'completed' || status === 'landed') return 'bg-green-500'
  if (status === 'failed' || status === 'ci-failed') return 'bg-red-500'
  if (status === 'ci-pending') return 'bg-yellow-500'
  if (status === 'skipped') return 'bg-stone-400'
  return 'bg-slate-400'
}

function ParentChip({ parent, onNavigate }: { parent: ApiSession; onNavigate: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(parent.id)}
      title={`Parent session: ${parent.slug}`}
      class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 max-w-[160px]"
      data-testid="chat-parent-chip"
    >
      <span aria-hidden="true" class="text-slate-400 dark:text-slate-500">↰</span>
      <span class={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusDot(parent.status)}`} />
      <span class="truncate">{parent.slug}</span>
    </button>
  )
}

function ChildrenChip({
  children,
  onNavigate,
}: {
  children: ApiSession[]
  onNavigate: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div class="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title={`${children.length} child session${children.length === 1 ? '' : 's'}`}
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200"
        data-testid="chat-children-chip"
      >
        <span aria-hidden="true" class="text-slate-400 dark:text-slate-500">↳</span>
        <span>
          {children.length} child{children.length === 1 ? '' : 'ren'}
        </span>
        <span aria-hidden="true" class="text-slate-400 dark:text-slate-500">▾</span>
      </button>
      {open && (
        <div
          class="absolute left-0 top-full mt-1 z-20 min-w-[200px] max-w-[280px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
          role="menu"
          data-testid="chat-children-menu"
        >
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onNavigate(c.id)
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid={`chat-children-item-${c.id}`}
            >
              <span class={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusDot(c.status)}`} />
              <span class="font-mono truncate flex-1">{c.slug}</span>
              <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 shrink-0">
                {c.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DagBreadcrumb({
  context,
  onNavigate,
}: {
  context: DagContext
  onNavigate: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const hasDeps = context.dependencies.length > 0 || context.dependents.length > 0
  const rootLabel = context.rootSlug ?? context.dag.rootTaskId.slice(0, 8)

  return (
    <div class="relative inline-flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={() => hasDeps && setOpen((v) => !v)}
        disabled={!hasDeps}
        aria-expanded={hasDeps ? open : undefined}
        aria-haspopup={hasDeps ? 'true' : undefined}
        title={hasDeps ? 'Show DAG dependencies' : `DAG rooted at ${rootLabel}`}
        class="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:hover:bg-indigo-50 dark:disabled:hover:bg-indigo-950/40 disabled:cursor-default px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300 max-w-[240px]"
        data-testid="chat-dag-breadcrumb"
      >
        <span class="font-medium uppercase tracking-wide text-[9px]">DAG</span>
        <span class="font-mono truncate">{rootLabel}</span>
        <span class="text-indigo-400 dark:text-indigo-500" aria-hidden="true">·</span>
        <span class="tabular-nums font-medium">
          {context.position}/{context.total}
        </span>
        {hasDeps && <span aria-hidden="true" class="text-indigo-400 dark:text-indigo-500">▾</span>}
      </button>
      {open && hasDeps && (
        <div
          class="absolute left-0 top-full mt-1 z-20 min-w-[220px] max-w-[300px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
          role="menu"
          data-testid="chat-dag-menu"
        >
          {context.dependencies.length > 0 && (
            <div class="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Depends on
            </div>
          )}
          {context.dependencies.map((d) => (
            <button
              key={`dep-${d.id}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onNavigate(d.id)
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid={`chat-dag-dep-${d.id}`}
            >
              <span class={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dagNodeDot(d.status)}`} />
              <span class="font-mono truncate flex-1">{d.slug}</span>
            </button>
          ))}
          {context.dependents.length > 0 && (
            <div class="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Unblocks
            </div>
          )}
          {context.dependents.map((d) => (
            <button
              key={`dependent-${d.id}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onNavigate(d.id)
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid={`chat-dag-dependent-${d.id}`}
            >
              <span class={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dagNodeDot(d.status)}`} />
              <span class="font-mono truncate flex-1">{d.slug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BranchChip({ branch }: { branch: string }) {
  return (
    <span
      title={`Branch: ${branch}`}
      class="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 max-w-[180px]"
      data-testid="chat-branch-chip"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true">
        <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm.75 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
      </svg>
      <span class="truncate">{branch}</span>
    </span>
  )
}

export interface ChatPaneProps {
  session: ApiSession
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  onNavigate: (sessionId: string) => void
  onSend: (text: string, sessionId: string) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
}

export function ChatPane({
  session,
  sessions,
  dags,
  onNavigate,
  onSend,
  onCommand,
}: ChatPaneProps) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<'stop' | 'close' | null>(null)

  const sessionById = useMemo(() => {
    const map = new Map<string, ApiSession>()
    for (const s of sessions) map.set(s.id, s)
    return map
  }, [sessions])

  const parent = session.parentId ? sessionById.get(session.parentId) ?? null : null
  const children = useMemo(
    () => session.childIds.map((id) => sessionById.get(id)).filter((s): s is ApiSession => Boolean(s)),
    [session.childIds, sessionById],
  )
  const dagContext = useMemo(
    () => findDagContext(session.id, dags, sessionById),
    [session.id, dags, sessionById],
  )

  const hasHierarchy = Boolean(parent) || children.length > 0 || Boolean(dagContext)

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
      <header class="flex flex-col gap-1 px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div class="flex items-center gap-2">
          <span class={`inline-block h-2 w-2 rounded-full ${statusDot(session.status)}`} />
          <span class="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {session.slug}
          </span>
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
          {session.branch && <BranchChip branch={session.branch} />}
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
        </div>
        {hasHierarchy && (
          <div class="flex items-center gap-1.5 flex-wrap" data-testid="chat-hierarchy-row">
            {parent && <ParentChip parent={parent} onNavigate={onNavigate} />}
            {children.length > 0 && <ChildrenChip children={children} onNavigate={onNavigate} />}
            {dagContext && <DagBreadcrumb context={dagContext} onNavigate={onNavigate} />}
          </div>
        )}
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
