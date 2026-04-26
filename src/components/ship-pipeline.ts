import type { ApiDagGraph, ApiDagNode } from '../api/types'

export type ShipColumn = 'running' | 'review' | 'ci' | 'landed'

export const SHIP_COLUMN_ORDER: ShipColumn[] = ['running', 'review', 'ci', 'landed']

export const SHIP_COLUMN_LABELS: Record<ShipColumn, string> = {
  running: 'Running',
  review: 'Review',
  ci: 'CI',
  landed: 'Landed',
}

export function classifyNodeForShip(status: ApiDagNode['status']): ShipColumn {
  switch (status) {
    case 'pending':
    case 'running':
    case 'failed':
      return 'running'
    case 'completed':
      return 'review'
    case 'ci-pending':
    case 'ci-failed':
      return 'ci'
    case 'landed':
    case 'skipped':
      return 'landed'
    case 'rebasing':
    case 'rebase-conflict':
      return 'ci'
  }
}

export function isShipPipeline(dag: ApiDagGraph): boolean {
  const nodes = Object.values(dag.nodes)
  if (nodes.length === 0) return false
  for (const node of nodes) {
    if (node.status === 'ci-pending' || node.status === 'ci-failed' || node.status === 'landed') {
      return true
    }
    if (node.session?.mode === 'ship-think') {
      return true
    }
  }
  return false
}

export interface ShipPipelineSummary {
  dag: ApiDagGraph
  columns: Record<ShipColumn, ApiDagNode[]>
  total: number
  landedCount: number
}

export function buildShipPipelineSummary(dag: ApiDagGraph): ShipPipelineSummary {
  const columns: Record<ShipColumn, ApiDagNode[]> = {
    running: [],
    review: [],
    ci: [],
    landed: [],
  }
  const nodes = Object.values(dag.nodes)
  for (const node of nodes) {
    columns[classifyNodeForShip(node.status)].push(node)
  }
  return {
    dag,
    columns,
    total: nodes.length,
    landedCount: columns.landed.length,
  }
}

export function selectShipPipelines(dags: ApiDagGraph[]): ShipPipelineSummary[] {
  const summaries: ShipPipelineSummary[] = []
  for (const dag of dags) {
    if (!isShipPipeline(dag)) continue
    summaries.push(buildShipPipelineSummary(dag))
  }
  summaries.sort((a, b) => (a.dag.updatedAt < b.dag.updatedAt ? 1 : -1))
  return summaries
}
