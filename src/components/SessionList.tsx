import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiDagGraph, ApiSession } from '../api/types'
import { buildSessionGroups, type SessionGroup } from '../state/hierarchy'

export type SessionItemKind = 'parent' | 'child' | 'variant' | undefined

export function statusDot(status: ApiSession['status']): string {
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

function shortRepo(repoUrl: string): string {
  const match = repoUrl.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : repoUrl
}

function dagStatusTone(status: ApiDagGraph['status']): string {
  if (status === 'running') return 'text-blue-600 dark:text-blue-400'
  if (status === 'completed') return 'text-green-600 dark:text-green-400'
  if (status === 'failed') return 'text-red-600 dark:text-red-400'
  return 'text-slate-500 dark:text-slate-400'
}

interface SessionItemProps {
  session: ApiSession
  active: boolean
  onSelect: () => void
  indent?: number
  kind?: SessionItemKind
}

function SessionItem({ session, active, onSelect, indent = 0, kind }: SessionItemProps) {
  const preview = session.command.slice(0, 60)
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

function groupKey(g: SessionGroup): string {
  switch (g.kind) {
    case 'dag': return `dag:${g.dag.id}`
    case 'parent-child': return `pc:${g.parent.id}`
    case 'variant': return `var:${g.groupId}`
    case 'standalone': return `s:${g.session.id}`
  }
}

interface GroupViewProps {
  group: SessionGroup
  activeSessionId: string | null
  onSelect: (id: string) => void
}

function GroupView({ group, activeSessionId, onSelect }: GroupViewProps) {
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
        <GroupHeader label="Variants" count={group.sessions.length} tone="variant" />
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

export interface SessionListProps {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  orientation: 'vertical' | 'horizontal'
}

export function SessionList({ sessions, dags, activeSessionId, onSelect, orientation }: SessionListProps) {
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
