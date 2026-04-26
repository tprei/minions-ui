import { useEffect, useState } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import type { ApiSession, SessionCheckpoint } from '../api/types'
import { Skeleton, SkeletonLines } from '../components/Skeleton'
import { confirm } from '../hooks/useConfirm'

interface CheckpointsTabProps {
  session: ApiSession
  sessionUpdatedAt: string
  client: ApiClient
  onRestored: (session: ApiSession) => void
}

function formatCheckpointTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function kindTone(kind: SessionCheckpoint['kind']): string {
  if (kind === 'completion') return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
  if (kind === 'manual') return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

export function CheckpointsTab({ session, sessionUpdatedAt, client, onRestored }: CheckpointsTabProps) {
  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .listCheckpoints(session.id)
      .then((items) => {
        if (cancelled) return
        setCheckpoints(items)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session.id, sessionUpdatedAt, client])

  const restoreDisabled = session.status === 'running' || session.status === 'pending'

  const handleRestore = async (checkpoint: SessionCheckpoint): Promise<void> => {
    const ok = await confirm({
      title: `Restore ${checkpoint.label}?`,
      message: 'Replaces the current workspace files with this checkpoint. The session must stay stopped while restoring.',
      confirmLabel: 'Restore',
      destructive: true,
    })
    if (!ok) return
    setRestoringId(checkpoint.id)
    setError(null)
    try {
      const result = await client.restoreCheckpoint(session.id, checkpoint.id)
      onRestored(result.session)
      setCheckpoints(await client.listCheckpoints(session.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoringId(null)
    }
  }

  if (loading) {
    return (
      <div class="flex-1 flex flex-col gap-3 p-3" data-testid="checkpoints-loading">
        <div class="flex items-center gap-2">
          <Skeleton width={110} height={14} rounded="sm" />
          <Skeleton width={80} height={14} rounded="sm" class="ml-auto" />
        </div>
        <SkeletonLines count={5} lineHeight={12} />
      </div>
    )
  }

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-slate-50 dark:bg-slate-900" data-testid="checkpoints-tab">
      <div class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <span class="text-xs font-medium text-slate-700 dark:text-slate-200">Checkpoints</span>
        <span class="text-xs text-slate-500 dark:text-slate-400">{checkpoints.length} saved</span>
      </div>
      {error && (
        <div class="px-4 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300" data-testid="checkpoints-error">
          {error}
        </div>
      )}
      {checkpoints.length === 0 ? (
        <div class="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 italic" data-testid="checkpoints-empty">
          No checkpoints yet.
        </div>
      ) : (
        <div class="flex-1 overflow-auto divide-y divide-slate-200 dark:divide-slate-700">
          {checkpoints.map((checkpoint) => (
            <div
              key={checkpoint.id}
              class="flex items-start gap-3 px-4 py-3 bg-white dark:bg-slate-900"
              data-testid="checkpoint-row"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {checkpoint.label}
                  </span>
                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${kindTone(checkpoint.kind)}`}>
                    {checkpoint.kind}
                  </span>
                  {checkpoint.dagNodeId && (
                    <span class="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                      {checkpoint.dagNodeId}
                    </span>
                  )}
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>turn {checkpoint.turn}</span>
                  <span>{formatCheckpointTime(checkpoint.createdAt)}</span>
                  <span class="font-mono">{checkpoint.sha.slice(0, 8)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRestore(checkpoint)}
                disabled={restoreDisabled || restoringId !== null}
                title={restoreDisabled ? 'Stop the session before restoring' : `Restore ${checkpoint.label}`}
                class="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="checkpoint-restore-btn"
              >
                {restoringId === checkpoint.id ? 'Restoring' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
