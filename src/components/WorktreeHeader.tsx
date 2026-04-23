import { useEffect } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import type { ConnectionStore, DiffStats } from '../state/types'
import { hasFeature } from '../api/features'

export function truncateCwd(cwd: string): { display: string; full: string } {
  const full = cwd
  const normalized = cwd.replace(/\/+$/, '').replace(/\.git$/, '')
  if (!normalized) return { display: cwd, full }
  const segments = normalized.split('/').filter((s) => s.length > 0 && !s.includes(':'))
  if (segments.length === 0) return { display: cwd, full }
  if (segments.length <= 2) return { display: segments.join('/'), full }
  const last = segments.slice(-2).join('/')
  return { display: last, full }
}

function StatBadge({ stats }: { stats: DiffStats }) {
  if (stats.truncated) {
    return (
      <span
        class="font-mono text-[11px] text-slate-500 dark:text-slate-400"
        title="Diff was truncated — full counts unavailable"
        data-testid="worktree-stats-truncated"
      >
        <span class="text-green-600 dark:text-green-400">+∞</span>{' '}
        <span class="text-red-600 dark:text-red-400">−∞</span>
      </span>
    )
  }
  if (stats.filesChanged === 0 && stats.insertions === 0 && stats.deletions === 0) {
    return (
      <span
        class="font-mono text-[11px] text-slate-400 dark:text-slate-500"
        title="No changes in this worktree"
        data-testid="worktree-stats"
      >
        no changes
      </span>
    )
  }
  const filesLabel = stats.filesChanged === 1 ? '1 file' : `${stats.filesChanged} files`
  return (
    <span
      class="font-mono text-[11px] text-slate-600 dark:text-slate-300"
      title={`${filesLabel} changed, +${stats.insertions} −${stats.deletions}`}
      data-testid="worktree-stats"
    >
      <span class="text-green-600 dark:text-green-400">+{stats.insertions}</span>{' '}
      <span class="text-red-600 dark:text-red-400">−{stats.deletions}</span>
    </span>
  )
}

export function WorktreeHeader({
  session,
  store,
}: {
  session: ApiSession
  store: ConnectionStore
}) {
  const diffEnabled = hasFeature(store, 'diff')
  const stats = store.diffStatsBySessionId.value.get(session.id)

  useEffect(() => {
    if (!diffEnabled) return
    if (store.diffStatsBySessionId.value.has(session.id)) return
    void store.loadDiffStats(session.id)
  }, [session.id, session.updatedAt, diffEnabled, store])

  if (!session.branch && !session.repo) return null

  const cwd = session.repo ? truncateCwd(session.repo) : null

  return (
    <div
      class="flex items-center gap-3 px-4 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-xs shrink-0"
      data-testid="worktree-header"
    >
      {session.branch && (
        <span class="flex items-center gap-1 min-w-0">
          <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">branch</span>
          <span
            class="font-mono text-slate-700 dark:text-slate-200 truncate"
            title={session.branch}
            data-testid="worktree-branch"
          >
            {session.branch}
          </span>
        </span>
      )}
      {cwd && (
        <span class="flex items-center gap-1 min-w-0">
          <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">cwd</span>
          <span
            class="font-mono text-slate-700 dark:text-slate-200 truncate"
            title={cwd.full}
            data-testid="worktree-cwd"
          >
            {cwd.display}
          </span>
        </span>
      )}
      {diffEnabled && stats && (
        <span class="ml-auto shrink-0">
          <StatBadge stats={stats} />
        </span>
      )}
    </div>
  )
}
