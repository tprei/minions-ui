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
  variantGroupId?: string
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

export interface RepoEntry {
  alias: string
  url: string
}

export interface VersionInfo {
  apiVersion: string
  libraryVersion: string
  features: string[]
  repos?: RepoEntry[]
}

export type CreateSessionMode = 'task' | 'plan' | 'think' | 'dag' | 'split' | 'stack' | 'ship' | 'doctor'

export interface CreateSessionRequest {
  prompt: string
  mode: CreateSessionMode
  repo?: string
}

export interface CreateSessionVariantsRequest extends CreateSessionRequest {
  count: number
}

export interface CreateSessionVariantsResult {
  groupId: string
  sessions: ApiSession[]
}

export type PrState = 'open' | 'closed' | 'merged'

export type PrCheckStatus =
  | 'queued'
  | 'in_progress'
  | 'pending'
  | 'success'
  | 'failure'
  | 'neutral'
  | 'skipped'
  | 'cancelled'
  | 'action_required'
  | 'stale'
  | 'timed_out'

export interface PrCheck {
  name: string
  status: PrCheckStatus
  conclusion?: string
  url?: string
}

export interface PrPreview {
  number: number
  url: string
  title: string
  body: string
  state: PrState
  draft: boolean
  mergeable: boolean | null
  branch: string
  baseBranch: string
  author: string
  updatedAt: string
  checks: PrCheck[]
}

export interface WorkspaceDiffStats {
  filesChanged: number
  insertions: number
  deletions: number
}

export interface WorkspaceDiff {
  sessionId: string
  branch: string
  baseBranch: string
  patch: string
  truncated: boolean
  stats: WorkspaceDiffStats
}

export interface ScreenshotEntry {
  file: string
  url: string
  capturedAt: string
  size: number
  width?: number
  height?: number
  caption?: string
}

export interface ScreenshotList {
  sessionId: string
  screenshots: ScreenshotEntry[]
}

export interface VapidPublicKey {
  key: string
}

export interface PushSubscriptionJSON {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface PushSubscribeAck {
  ok: true
  id: string
}
