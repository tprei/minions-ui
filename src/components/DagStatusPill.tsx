import type { ApiDagGraph } from '../api/types'

interface DagStatusPillProps {
  dags: ApiDagGraph[]
}

interface DagStats {
  total: number
  completed: number
  failed: number
  running: number
}

function calculateDagStats(dags: ApiDagGraph[]): DagStats {
  const stats: DagStats = {
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
  }

  for (const dag of dags) {
    const nodes = Object.values(dag.nodes)
    stats.total += nodes.length

    for (const node of nodes) {
      if (node.status === 'completed' || node.status === 'landed') {
        stats.completed++
      } else if (node.status === 'failed' || node.status === 'ci-failed' || node.status === 'rebase-conflict') {
        stats.failed++
      } else if (node.status === 'running' || node.status === 'rebasing') {
        stats.running++
      }
    }
  }

  return stats
}

export function DagStatusPill({ dags }: DagStatusPillProps) {
  if (dags.length === 0) return null

  const stats = calculateDagStats(dags)
  if (stats.total === 0) return null

  const parts: string[] = []

  parts.push(`${stats.completed}/${stats.total}`)

  if (stats.failed > 0) {
    parts.push(`${stats.failed} failed`)
  }

  return (
    <span
      class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0"
      data-testid="dag-status-pill"
      title={`DAG progress: ${stats.completed} completed, ${stats.running} running, ${stats.failed} failed, ${stats.total - stats.completed - stats.running - stats.failed} pending`}
    >
      {stats.running > 0 && (
        <span class="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
      )}
      <span>{parts.join(', ')}</span>
    </span>
  )
}
