import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import type { Connection } from '../connections/types'
import type { ConnectionStore } from '../state/types'
import type { ViewMode } from '../App'
import { formatRoute } from '../routing/route'

export type CommandKind =
  | 'help'
  | 'view'
  | 'new-task'
  | 'switch-connection'
  | 'jump-session'
  | 'stop-session'
  | 'open-pr'
  | 'refresh'

export interface PaletteCommand {
  id: string
  kind: CommandKind
  title: string
  subtitle?: string
  hint?: string
  keywords: string
  run: () => void | Promise<void>
}

export interface CommandPaletteProps {
  open: boolean
  store: ConnectionStore | null
  sessions: ApiSession[]
  connections: Connection[]
  activeConnectionId: string | null
  onClose: () => void
  onShowHelp: () => void
  onSwitchView: (view: ViewMode) => void
  onSwitchConnection: (id: string) => void
  onNewTask: () => void
  onRefresh: () => void
  onJumpSession?: (slug: string) => void
}

interface CommandSourceContext {
  store: ConnectionStore | null
  sessions: ApiSession[]
  connections: Connection[]
  activeConnectionId: string | null
  onClose: () => void
  onShowHelp: () => void
  onSwitchView: (view: ViewMode) => void
  onSwitchConnection: (id: string) => void
  onNewTask: () => void
  onRefresh: () => void
  onJumpSession?: (slug: string) => void
}

export function buildCommands(ctx: CommandSourceContext): PaletteCommand[] {
  const commands: PaletteCommand[] = []
  const close = ctx.onClose

  commands.push({
    id: 'new-task',
    kind: 'new-task',
    title: 'New task',
    subtitle: 'Open the task bar and start drafting',
    hint: 'n',
    keywords: 'new task create start prompt',
    run: () => {
      close()
      ctx.onNewTask()
    },
  })

  commands.push({
    id: 'view-list',
    kind: 'view',
    title: 'View: Sessions list',
    hint: 'g l',
    keywords: 'view list sessions sidebar',
    run: () => {
      close()
      ctx.onSwitchView('list')
    },
  })
  commands.push({
    id: 'view-canvas',
    kind: 'view',
    title: 'View: Canvas',
    hint: 'g c',
    keywords: 'view canvas dag graph universe',
    run: () => {
      close()
      ctx.onSwitchView('canvas')
    },
  })
  commands.push({
    id: 'view-ship',
    kind: 'view',
    title: 'View: Ship pipeline',
    hint: 'g s',
    keywords: 'view ship pipeline pr',
    run: () => {
      close()
      ctx.onSwitchView('ship')
    },
  })
  commands.push({
    id: 'view-kanban',
    kind: 'view',
    title: 'View: Kanban',
    hint: 'g k',
    keywords: 'view kanban board',
    run: () => {
      close()
      ctx.onSwitchView('kanban')
    },
  })

  commands.push({
    id: 'refresh',
    kind: 'refresh',
    title: 'Refresh sessions and DAGs',
    hint: 'r',
    keywords: 'refresh refetch reload sync',
    run: () => {
      close()
      ctx.onRefresh()
    },
  })

  commands.push({
    id: 'help',
    kind: 'help',
    title: 'Show keyboard shortcuts',
    hint: '?',
    keywords: 'help keyboard shortcuts cheatsheet ?',
    run: () => {
      close()
      ctx.onShowHelp()
    },
  })

  for (const conn of ctx.connections) {
    if (conn.id === ctx.activeConnectionId) continue
    commands.push({
      id: `switch-${conn.id}`,
      kind: 'switch-connection',
      title: `Switch to ${conn.label}`,
      subtitle: conn.baseUrl,
      keywords: `switch connection ${conn.label} ${conn.baseUrl}`,
      run: () => {
        close()
        ctx.onSwitchConnection(conn.id)
      },
    })
  }

  for (const session of ctx.sessions) {
    commands.push({
      id: `jump-${session.id}`,
      kind: 'jump-session',
      title: `Jump to ${session.slug}`,
      subtitle: sessionSubtitle(session),
      keywords: `jump session ${session.slug} ${session.command} ${session.mode} ${session.status}`,
      run: () => {
        close()
        if (ctx.onJumpSession) {
          ctx.onJumpSession(session.slug)
        } else if (typeof window !== 'undefined') {
          window.location.hash = formatRoute({ name: 'session', sessionSlug: session.slug })
        }
      },
    })
  }

  if (ctx.store) {
    const store = ctx.store
    for (const session of ctx.sessions) {
      if (session.status !== 'running' && session.status !== 'pending') continue
      commands.push({
        id: `stop-${session.id}`,
        kind: 'stop-session',
        title: `Stop ${session.slug}`,
        subtitle: 'Send /stop to this session',
        keywords: `stop kill cancel session ${session.slug}`,
        run: () => {
          close()
          void store.sendCommand({ action: 'stop', sessionId: session.id })
        },
      })
    }
  }

  for (const session of ctx.sessions) {
    if (!session.prUrl) continue
    commands.push({
      id: `pr-${session.id}`,
      kind: 'open-pr',
      title: `Open PR for ${session.slug}`,
      subtitle: session.prUrl,
      keywords: `pr pull request open ${session.slug} ${session.prUrl}`,
      run: () => {
        close()
        if (typeof window !== 'undefined') {
          window.open(session.prUrl, '_blank', 'noopener,noreferrer')
        }
      },
    })
  }

  return commands
}

function sessionSubtitle(session: ApiSession): string {
  const parts: string[] = [session.status]
  if (session.mode) parts.push(session.mode)
  if (session.repo) parts.push(session.repo)
  return parts.join(' · ')
}

export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++
  }
  return i === q.length
}

export function rankCommand(query: string, command: PaletteCommand): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const title = command.title.toLowerCase()
  if (title === q) return 1000
  if (title.startsWith(q)) return 800
  const titleIdx = title.indexOf(q)
  if (titleIdx !== -1) return 500 - titleIdx
  if (command.keywords.toLowerCase().includes(q)) return 200
  if (fuzzyMatch(q, title)) return 100
  if (fuzzyMatch(q, command.keywords)) return 50
  return -1
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  if (!query.trim()) return commands
  const ranked = commands
    .map((c) => ({ c, score: rankCommand(query.trim(), c) }))
    .filter((x) => x.score >= 0)
  ranked.sort((a, b) => b.score - a.score)
  return ranked.map((x) => x.c)
}

const KIND_LABEL: Record<CommandKind, string> = {
  'help': 'Help',
  'view': 'View',
  'new-task': 'Action',
  'switch-connection': 'Connection',
  'jump-session': 'Navigate',
  'stop-session': 'Session',
  'open-pr': 'Session',
  'refresh': 'Action',
}

export function CommandPalette({
  open,
  store,
  sessions,
  connections,
  activeConnectionId,
  onClose,
  onShowHelp,
  onSwitchView,
  onSwitchConnection,
  onNewTask,
  onRefresh,
  onJumpSession,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const commands = useMemo(
    () => buildCommands({
      store,
      sessions,
      connections,
      activeConnectionId,
      onClose,
      onShowHelp,
      onSwitchView,
      onSwitchConnection,
      onNewTask,
      onRefresh,
      onJumpSession,
    }),
    [store, sessions, connections, activeConnectionId, onClose, onShowHelp, onSwitchView, onSwitchConnection, onNewTask, onRefresh, onJumpSession],
  )

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const cmd = filtered[activeIdx]
        if (cmd) {
          e.preventDefault()
          void cmd.run()
        }
      } else if (e.key === 'Home') {
        e.preventDefault()
        setActiveIdx(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setActiveIdx(Math.max(0, filtered.length - 1))
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, filtered, activeIdx, onClose])

  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIdx, open])

  if (!open) return null

  return (
    <div
      class="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
    >
      <div
        class="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="command-palette-backdrop"
      />
      <div class="relative z-10 w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl flex flex-col overflow-hidden max-h-[70vh]">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
          <span class="text-slate-400 dark:text-slate-500 text-sm" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            placeholder="Type a command or search…"
            class="flex-1 bg-transparent border-0 outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 py-1.5"
            aria-label="Command palette search"
            data-testid="command-palette-input"
            autoComplete="off"
            spellcheck={false}
          />
          <kbd class="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">esc</kbd>
        </div>
        {filtered.length === 0 ? (
          <div
            class="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
            data-testid="command-palette-empty"
          >
            No commands match "{query}"
          </div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Available commands"
            class="overflow-y-auto py-1"
            data-testid="command-palette-list"
          >
            {filtered.map((cmd, idx) => {
              const active = idx === activeIdx
              return (
                <li key={cmd.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-idx={idx}
                    data-testid={`command-palette-item-${cmd.id}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => void cmd.run()}
                    class={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-indigo-50 dark:bg-indigo-900/40 text-slate-900 dark:text-slate-100'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span
                      class={`shrink-0 inline-flex items-center justify-center text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 ${
                        active
                          ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {KIND_LABEL[cmd.kind]}
                    </span>
                    <span class="flex-1 min-w-0">
                      <span class="block truncate font-medium">{cmd.title}</span>
                      {cmd.subtitle && (
                        <span class="block truncate text-xs text-slate-500 dark:text-slate-400">{cmd.subtitle}</span>
                      )}
                    </span>
                    {cmd.hint && (
                      <kbd class="shrink-0 text-[10px] font-mono text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5">
                        {cmd.hint}
                      </kbd>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div class="flex items-center gap-3 px-3 py-1.5 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
          <span><kbd class="border border-slate-200 dark:border-slate-700 rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd class="border border-slate-200 dark:border-slate-700 rounded px-1">↵</kbd> run</span>
          <span class="ml-auto">{filtered.length} of {commands.length}</span>
        </div>
      </div>
    </div>
  )
}
