// Mirror of telegram-minions src/api-server.ts:13-99. Keep in sync.

export type AttentionReason = 'failed' | 'waiting_for_feedback' | 'interrupted' | 'ci_fix' | 'idle_long'
export type QuickActionType = 'make_pr' | 'retry' | 'resume'
export interface QuickAction { type: QuickActionType; label: string; message: string }
export type PlanActionType = 'execute' | 'split' | 'stack' | 'dag'
export interface ConversationMessage { role: 'user' | 'assistant'; text: string }

export interface ApiSession {
  id: string
  slug: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  command: string
  repo?: string
  branch?: string
  prUrl?: string
  threadId?: number
  chatId?: number
  createdAt: string
  updatedAt: string
  parentId?: string
  childIds: string[]
  needsAttention: boolean
  attentionReasons: AttentionReason[]
  quickActions: QuickAction[]
  mode: string
  conversation: ConversationMessage[]
}

export interface ApiDagNode {
  id: string
  slug: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'ci-pending' | 'ci-failed' | 'landed'
  dependencies: string[]
  dependents: string[]
  session?: ApiSession
}

export interface ApiDagGraph {
  id: string
  rootTaskId: string
  nodes: Record<string, ApiDagNode>
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
}

export interface ApiResponse<T> { data: T; error?: string }
export interface CommandResult { success: boolean; error?: string }

export type SseEvent =
  | { type: 'session_created'; session: ApiSession }
  | { type: 'session_updated'; session: ApiSession }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'dag_created'; dag: ApiDagGraph }
  | { type: 'dag_updated'; dag: ApiDagGraph }
  | { type: 'dag_deleted'; dagId: string }

export type MinionCommand =
  | { action: 'reply'; sessionId: string; message: string }
  | { action: 'stop'; sessionId: string }
  | { action: 'close'; sessionId: string }
  | { action: 'plan_action'; sessionId: string; planAction: PlanActionType }

export interface VersionInfo {
  apiVersion: string
  libraryVersion: string
  features: string[]
}
