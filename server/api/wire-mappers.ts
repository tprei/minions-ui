import type { ApiSession, ApiDagGraph, ApiDagNode, TranscriptEvent, ConversationMessage } from '../../shared/api-types'
import type { SessionRow } from '../db/sqlite'
import { computeAttentionReasons, computeQuickActions } from './attention'

interface DagRow {
  id: string
  root_task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: number
  updated_at: number
}

interface DagNodeRow {
  dag_id: string
  id: string
  slug: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'ci-pending' | 'ci-failed' | 'landed'
  session_id: string | null
  dependencies: string[]
  dependents: string[]
  payload: Record<string, unknown>
}

export function sessionRowToApi(row: SessionRow): ApiSession {
  const now = Date.now()
  const attentionReasons = computeAttentionReasons(row, now)
  const quickActions = computeQuickActions(row)
  const needsAttention = attentionReasons.length > 0

  return {
    id: row.id,
    slug: row.slug,
    status: row.status === 'waiting_input' ? 'running' : row.status,
    command: row.command,
    mode: row.mode,
    repo: row.repo ?? undefined,
    branch: row.branch ?? undefined,
    prUrl: row.pr_url ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    parentId: row.parent_id ?? undefined,
    childIds: [],
    needsAttention,
    attentionReasons,
    quickActions,
    conversation: row.conversation as ConversationMessage[],
    variantGroupId: row.variant_group_id ?? undefined,
  }
}

export function dagToApi(dag: DagRow, nodes: DagNodeRow[], sessionMap: Map<string, ApiSession>): ApiDagGraph {
  const nodeRecords: Record<string, ApiDagNode> = {}
  for (const node of nodes) {
    nodeRecords[node.id] = {
      id: node.id,
      slug: node.slug,
      status: node.status,
      dependencies: node.dependencies,
      dependents: node.dependents,
      session: node.session_id !== null ? sessionMap.get(node.session_id) : undefined,
    }
  }
  return {
    id: dag.id,
    rootTaskId: dag.root_task_id,
    nodes: nodeRecords,
    status: dag.status,
    createdAt: new Date(dag.created_at).toISOString(),
    updatedAt: new Date(dag.updated_at).toISOString(),
  }
}

export interface EventDbRow {
  session_id: string
  seq: number
  turn: number
  type: string
  timestamp: number
  payload: string
}

export function eventRowToTranscript(row: EventDbRow): TranscriptEvent {
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  return {
    ...payload,
    type: row.type,
    seq: row.seq,
    turn: row.turn,
    timestamp: row.timestamp,
    sessionId: row.session_id,
  } as TranscriptEvent
}
