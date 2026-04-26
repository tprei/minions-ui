import type { ApiDagGraph, ApiSession } from '../api/types'

export interface ConnectionStats {
  unreadCount: number
  dagProgress: DagProgress | null
}

export interface DagProgress {
  done: number
  total: number
  failed: number
  running: number
}

export function computeConnectionStats(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
): ConnectionStats {
  const unreadCount = sessions.filter((s) => s.needsAttention).length

  let totalDagNodes = 0
  let doneDagNodes = 0
  let failedDagNodes = 0
  let runningDagNodes = 0

  for (const dag of dags) {
    const nodes = Object.values(dag.nodes)
    totalDagNodes += nodes.length
    doneDagNodes += nodes.filter((n) => n.status === 'completed' || n.status === 'landed').length
    failedDagNodes += nodes.filter(
      (n) => n.status === 'failed' || n.status === 'ci-failed',
    ).length
    runningDagNodes += nodes.filter(
      (n) =>
        n.status === 'running' ||
        n.status === 'ci-pending' ||
        n.status === 'rebasing',
    ).length
  }

  const dagProgress: DagProgress | null =
    totalDagNodes > 0
      ? {
          done: doneDagNodes,
          total: totalDagNodes,
          failed: failedDagNodes,
          running: runningDagNodes,
        }
      : null

  return { unreadCount, dagProgress }
}
