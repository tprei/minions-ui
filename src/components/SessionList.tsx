import { useEffect, useMemo } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../api/types'
import { classifySessions } from '../state/hierarchy'
import { STATUS_CONFIG } from './shared'

type Status = ApiDagNode['status']

export function buildDagStatusIndex(dags: ApiDagGraph[]): Map<string, Status> {
  const m = new Map<string, Status>()
  for (const dag of dags) {
    for (const node of Object.values(dag.nodes)) {
      if (node.session) m.set(node.session.id, node.status)
    }
  }
  return m
}

export function getEffectiveStatus(
  session: ApiSession,
  dagStatusById: Map<string, Status>,
): Status {
  return dagStatusById.get(session.id) ?? session.status
}

export function shortRepo(repoUrl: string): string {
  const match = repoUrl.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : repoUrl
}

function byUpdatedDesc(a: ApiSession, b: ApiSession): number {
  return a.updatedAt < b.updatedAt ? 1 : -1
}

interface DagGroupData {
  dag: ApiDagGraph
  sessions: ApiSession[]
  counts: Record<Status, number>
  landed: number
  total: number
}

export function buildDagGroups(
  dags: ApiDagGraph[],
  sessionById: Map<string, ApiSession>,
): DagGroupData[] {
  const groups: DagGroupData[] = []
  for (const dag of dags) {
    const nodes = Object.values(dag.nodes)
    if (nodes.length === 0) continue
    const sessions: ApiSession[] = []
    const counts = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      'ci-pending': 0,
      'ci-failed': 0,
      landed: 0,
    } as Record<Status, number>
    for (const node of nodes) {
      counts[node.status] = (counts[node.status] ?? 0) + 1
      const latest = node.session ? sessionById.get(node.session.id) ?? node.session : null
      if (latest) sessions.push(latest)
    }
    sessions.sort(byUpdatedDesc)
    groups.push({
      dag,
      sessions,
      counts,
      landed: counts.landed,
      total: nodes.length,
    })
  }
  groups.sort((a, b) => (a.dag.updatedAt < b.dag.updatedAt ? 1 : -1))
  return groups
}

function collectTreeChildren(
  root: ApiSession,
  sessionById: Map<string, ApiSession>,
  visited: Set<string> = new Set(),
): ApiSession[] {
  if (visited.has(root.id)) return []
  visited.add(root.id)
  const result: ApiSession[] = []
  const children = root.childIds
    .map((id) => sessionById.get(id))
    .filter((s): s is ApiSession => !!s)
    .sort(byUpdatedDesc)
  for (const child of children) {
    result.push(child)
    result.push(...collectTreeChildren(child, sessionById, visited))
  }
  return result
}

interface TreeRow {
  session: ApiSession
  depth: number
}

function flattenTree(
  root: ApiSession,
  sessionById: Map<string, ApiSession>,
  visited: Set<string> = new Set(),
  depth = 0,
): TreeRow[] {
  if (visited.has(root.id)) return []
  visited.add(root.id)
  const rows: TreeRow[] = [{ session: root, depth }]
  const children = root.childIds
    .map((id) => sessionById.get(id))
    .filter((s): s is ApiSession => !!s)
    .sort(byUpdatedDesc)
  for (const child of children) {
    rows.push(...flattenTree(child, sessionById, visited, depth + 1))
  }
  return rows
}

function SessionRow({
  session,
  active,
  depth,
  status,
  onSelect,
}: {
  session: ApiSession
  active: boolean
  depth: number
  status: Status
  onSelect: () => void
}) {
  const preview =
    session.conversation.length > 0
      ? session.conversation[session.conversation.length - 1].text.slice(0, 60)
      : session.command.slice(0, 60)

  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const statusColor =
    status === 'running'
      ? 'bg-blue-500 animate-pulse'
      : status === 'completed'
        ? 'bg-green-500'
        : status === 'failed'
          ? 'bg-red-500'
          : status === 'landed'
            ? 'bg-emerald-500'
            : status === 'ci-pending'
              ? 'bg-yellow-500'
              : status === 'ci-failed'
                ? 'bg-orange-500'
                : status === 'skipped'
                  ? 'bg-stone-400'
                  : 'bg-slate-400'

  const rowBase =
    'w-full text-left px-3 py-2 rounded-md border transition-colors flex flex-col gap-1'
  const rowState = active
    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700'
    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'

  const indentStyle =
    depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined

  return (
    <div class="relative" style={indentStyle} data-depth={depth}>
      {depth > 0 && (
        <span
          aria-hidden="true"
          class="absolute top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
          style={{ left: `${(depth - 1) * 14 + 6}px` }}
        />
      )}
      <button
        type="button"
        class={`${rowBase} ${rowState}`}
        onClick={onSelect}
        data-testid={`session-item-${session.id}`}
      >
        <div class="flex items-center gap-2">
          <span
            aria-label={statusCfg.label}
            title={statusCfg.label}
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusColor}`}
          />
          <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {session.slug}
          </span>
          {session.repo && (
            <span class="text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-slate-600 dark:text-slate-300 truncate">
              {shortRepo(session.repo)}
            </span>
          )}
          <span class="ml-auto text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {status}
          </span>
        </div>
        <div class="text-xs text-slate-600 dark:text-slate-400 truncate">
          {preview || '—'}
        </div>
      </button>
    </div>
  )
}

function GroupSectionHeader({
  label,
  count,
  expanded,
  onToggle,
  testid,
}: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  testid: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testid}
      aria-expanded={expanded}
      class="w-full flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 select-none"
    >
      <span
        aria-hidden="true"
        class={`inline-block w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
      >
        ▸
      </span>
      <span>{label}</span>
      <span class="ml-auto rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-normal text-slate-700 dark:text-slate-200">
        {count}
      </span>
    </button>
  )
}

function DagSummaryPill({
  label,
  count,
  tone,
  testid,
}: {
  label: string
  count: number
  tone: 'blue' | 'red' | 'emerald' | 'amber' | 'orange' | 'slate'
  testid?: string
}) {
  const toneClass: Record<typeof tone, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
    slate: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  }
  return (
    <span
      data-testid={testid}
      class={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${toneClass[tone]}`}
    >
      <span>{label}</span>
      <span>{count}</span>
    </span>
  )
}

function DagSummaryCard({ group }: { group: DagGroupData }) {
  const { dag, landed, total, counts } = group
  const pct = total > 0 ? Math.round((landed / total) * 100) : 0
  const running = counts.running + counts['ci-pending']
  const failed = counts.failed + counts['ci-failed']
  const pending = counts.pending
  const skipped = counts.skipped

  return (
    <div
      class="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 px-2 py-1.5 flex flex-col gap-1"
      data-testid={`dag-subheader-${dag.id}`}
    >
      <div class="flex items-center gap-2 text-[11px]">
        <span
          class="font-mono font-semibold text-indigo-900 dark:text-indigo-200 truncate"
          title={dag.id}
        >
          {dag.id.slice(0, 8)}
        </span>
        <span class="text-slate-500 dark:text-slate-400 tabular-nums">
          {landed}/{total} landed
        </span>
        <span class="ml-auto font-medium text-indigo-700 dark:text-indigo-300 tabular-nums">
          {pct}%
        </span>
      </div>
      <div
        class="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        data-testid={`dag-progress-${dag.id}`}
      >
        <div
          class="h-full bg-emerald-500 dark:bg-emerald-400 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div class="flex flex-wrap items-center gap-1">
        {running > 0 && <DagSummaryPill label="▶" count={running} tone="blue" testid={`dag-pill-running-${dag.id}`} />}
        {failed > 0 && <DagSummaryPill label="✕" count={failed} tone="red" testid={`dag-pill-failed-${dag.id}`} />}
        {landed > 0 && <DagSummaryPill label="✓" count={landed} tone="emerald" testid={`dag-pill-landed-${dag.id}`} />}
        {pending > 0 && <DagSummaryPill label="◌" count={pending} tone="slate" />}
        {skipped > 0 && <DagSummaryPill label="⏭" count={skipped} tone="slate" />}
      </div>
    </div>
  )
}

type ExpandedState = { dag: boolean; tree: boolean; standalone: boolean }

export function getSiblingIds(
  activeId: string,
  dagGroups: DagGroupData[],
  treeRoots: ApiSession[],
  sessionById: Map<string, ApiSession>,
  standalone: ApiSession[],
): string[] {
  for (const group of dagGroups) {
    if (group.sessions.some((s) => s.id === activeId)) {
      return group.sessions.map((s) => s.id)
    }
  }
  for (const root of treeRoots) {
    const rows = flattenTree(root, sessionById)
    const active = rows.find((r) => r.session.id === activeId)
    if (!active) continue
    const parentId = active.session.parentId
    if (!parentId) {
      return treeRoots.map((r) => r.id)
    }
    return rows
      .filter((r) => r.session.parentId === parentId)
      .map((r) => r.session.id)
  }
  if (standalone.some((s) => s.id === activeId)) {
    return standalone.map((s) => s.id)
  }
  return []
}

export function getSiblingTarget(
  activeId: string | null,
  siblings: string[],
  direction: 1 | -1,
): string | null {
  if (!activeId || siblings.length === 0) return null
  const idx = siblings.indexOf(activeId)
  if (idx === -1) return null
  const len = siblings.length
  const next = (idx + direction + len) % len
  return siblings[next]
}

export function SessionList({
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
  const expanded = useSignal<ExpandedState>({
    dag: true,
    tree: true,
    standalone: true,
  })

  const classification = useMemo(
    () => classifySessions(sessions, dags),
    [sessions, dags],
  )
  const dagStatusById = useMemo(() => buildDagStatusIndex(dags), [dags])
  const dagGroups = useMemo(
    () => buildDagGroups(dags, classification.sessionById),
    [dags, classification.sessionById],
  )

  const sortedRoots = useMemo(
    () => [...classification.parentChildRoots].sort(byUpdatedDesc),
    [classification.parentChildRoots],
  )
  const sortedStandalone = useMemo(
    () => [...classification.standalone].sort(byUpdatedDesc),
    [classification.standalone],
  )

  const dagMemberCount = useMemo(
    () => dagGroups.reduce((n, g) => n + g.sessions.length, 0),
    [dagGroups],
  )
  const treeMemberCount = useMemo(() => {
    let n = 0
    for (const root of sortedRoots) {
      n += 1 + collectTreeChildren(root, classification.sessionById).length
    }
    return n
  }, [sortedRoots, classification.sessionById])

  const toggle = (k: keyof ExpandedState) => {
    expanded.value = { ...expanded.value, [k]: !expanded.value[k] }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '[' && e.key !== ']') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }
      if (!activeSessionId) return
      const siblings = getSiblingIds(
        activeSessionId,
        dagGroups,
        sortedRoots,
        classification.sessionById,
        sortedStandalone,
      )
      const next = getSiblingTarget(activeSessionId, siblings, e.key === ']' ? 1 : -1)
      if (next && next !== activeSessionId) {
        e.preventDefault()
        onSelect(next)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    activeSessionId,
    dagGroups,
    sortedRoots,
    sortedStandalone,
    classification.sessionById,
    onSelect,
  ])

  if (sessions.length === 0) {
    return (
      <div class="text-xs text-slate-500 dark:text-slate-400 p-3 italic">
        No sessions yet. Send a /task above.
      </div>
    )
  }

  return (
    <div
      class="flex flex-col gap-3 p-2 overflow-y-auto"
      data-testid="session-list"
    >
      {dagGroups.length > 0 && (
        <section data-testid="session-group-dag" class="flex flex-col gap-1">
          <GroupSectionHeader
            label={`DAGs · ${dagGroups.length}`}
            count={dagMemberCount}
            expanded={expanded.value.dag}
            onToggle={() => toggle('dag')}
            testid="group-toggle-dag"
          />
          {expanded.value.dag &&
            dagGroups.map((group) => (
              <div key={group.dag.id} class="flex flex-col gap-1">
                <DagSummaryCard group={group} />
                <div class="flex flex-col gap-1">
                  {group.sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      active={activeSessionId === s.id}
                      depth={1}
                      status={getEffectiveStatus(s, dagStatusById)}
                      onSelect={() => onSelect(s.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}

      {sortedRoots.length > 0 && (
        <section data-testid="session-group-tree" class="flex flex-col gap-1">
          <GroupSectionHeader
            label={`Trees · ${sortedRoots.length}`}
            count={treeMemberCount}
            expanded={expanded.value.tree}
            onToggle={() => toggle('tree')}
            testid="group-toggle-tree"
          />
          {expanded.value.tree &&
            sortedRoots.map((root) => {
              const rows = flattenTree(root, classification.sessionById)
              return (
                <div
                  key={root.id}
                  class="flex flex-col gap-1"
                  data-testid={`tree-${root.id}`}
                >
                  {rows.map(({ session, depth }) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={activeSessionId === session.id}
                      depth={depth}
                      status={getEffectiveStatus(session, dagStatusById)}
                      onSelect={() => onSelect(session.id)}
                    />
                  ))}
                </div>
              )
            })}
        </section>
      )}

      {sortedStandalone.length > 0 && (
        <section
          data-testid="session-group-standalone"
          class="flex flex-col gap-1"
        >
          <GroupSectionHeader
            label="Solo"
            count={sortedStandalone.length}
            expanded={expanded.value.standalone}
            onToggle={() => toggle('standalone')}
            testid="group-toggle-standalone"
          />
          {expanded.value.standalone &&
            sortedStandalone.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={activeSessionId === s.id}
                depth={0}
                status={getEffectiveStatus(s, dagStatusById)}
                onSelect={() => onSelect(s.id)}
              />
            ))}
        </section>
      )}
    </div>
  )
}
