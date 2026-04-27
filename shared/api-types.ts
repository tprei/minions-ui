export interface ProviderProfile {
  id: string
  name: string
  baseUrl?: string
  authToken?: string
  opusModel?: string
  sonnetModel?: string
  haikuModel?: string
}

export type AttentionReason = 'failed' | 'waiting_for_feedback' | 'interrupted' | 'ci_fix' | 'idle_long'
export type QuickActionType = 'make_pr' | 'retry' | 'resume'
export interface QuickAction { type: QuickActionType; label: string; message: string }
export type PlanActionType = 'execute' | 'split' | 'stack' | 'dag'
export interface ConversationMessage { role: 'user' | 'assistant'; text: string }
export type ShipStage = 'think' | 'plan' | 'dag' | 'verify' | 'done'

export type FeedbackVote = 'up' | 'down'
export type FeedbackReason = 'incorrect' | 'off_topic' | 'too_verbose' | 'unsafe' | 'other'
export interface FeedbackMetadata {
  kind: 'feedback'
  vote: FeedbackVote
  reason?: FeedbackReason
  comment?: string
  sourceSessionId: string
  sourceSessionSlug: string
  sourceMessageBlockId: string
}

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
  stage?: ShipStage
  conversation: ConversationMessage[]
  variantGroupId?: string
  transcriptUrl?: string
  metadata?: Record<string, unknown>
}

export interface ApiDagNode {
  id: string
  slug: string
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'ci-pending'
    | 'ci-failed'
    | 'landed'
    | 'rebasing'
    | 'rebase-conflict'
  dependencies: string[]
  dependents: string[]
  session?: ApiSession
  error?: string
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
export interface CommandResult { success: boolean; error?: string; dagId?: string }

export interface QualityGateResult {
  name: string
  command: string[]
  required: boolean
  passed: boolean
  skipped: boolean
  output: string
  durationMs: number
}

export interface QualityReport {
  allPassed: boolean
  results: QualityGateResult[]
  configPath?: string
  configError?: string
}

export type MergeReadinessStatus = 'ready' | 'blocked' | 'pending' | 'unknown'

export interface MergeReadinessCheck {
  id: string
  label: string
  status: MergeReadinessStatus
  required: boolean
  summary: string
  details?: string
}

export interface MergeReadiness {
  sessionId: string
  generatedAt: string
  status: MergeReadinessStatus
  prUrl?: string
  configPath?: string
  checks: MergeReadinessCheck[]
}

export interface ReadinessSummaryBucket {
  key: string
  count: number
}

export interface ReadinessSummary {
  generatedAt: string
  sessions: {
    total: number
    byStatus: ReadinessSummaryBucket[]
    byMode: ReadinessSummaryBucket[]
    byRepo: ReadinessSummaryBucket[]
  }
  pullRequests: {
    withPr: number
    withoutPr: number
  }
  quality: {
    withReport: number
    passed: number
    failed: number
    missing: number
  }
  checkpoints: {
    total: number
    sessionsWithCheckpoints: number
  }
}

export type SessionCheckpointKind = 'turn' | 'completion' | 'manual'

export interface SessionCheckpoint {
  id: string
  sessionId: string
  turn: number
  kind: SessionCheckpointKind
  label: string
  sha: string
  baseSha: string
  branch?: string
  dagId?: string
  dagNodeId?: string
  createdAt: string
}

export interface RestoreCheckpointResult {
  checkpoint: SessionCheckpoint
  session: ApiSession
}

export type ExternalTaskSource = 'github_issue' | 'github_pr_comment' | 'linear_issue' | 'slack_thread'
export type ExternalTaskStatus = 'started' | 'failed'

export interface CreateExternalTaskRequest {
  source: ExternalTaskSource
  externalId: string
  prompt: string
  repo?: string
  mode?: Extract<CreateSessionMode, 'task' | 'plan' | 'think' | 'review' | 'ship'>
  title?: string
  url?: string
  author?: string
  metadata?: Record<string, unknown>
}

export interface ExternalTask {
  id: string
  source: ExternalTaskSource
  externalId: string
  sessionId: string
  status: ExternalTaskStatus
  repo?: string
  mode: string
  title?: string
  url?: string
  author?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ExternalTaskResult {
  task: ExternalTask
  session: ApiSession
  existing: boolean
}

export interface AuditEvent {
  id: string
  action: string
  sessionId?: string
  targetType?: string
  targetId?: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type SseEvent =
  | { type: 'session_created'; session: ApiSession }
  | { type: 'session_updated'; session: ApiSession }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'dag_created'; dag: ApiDagGraph }
  | { type: 'dag_updated'; dag: ApiDagGraph }
  | { type: 'dag_deleted'; dagId: string }
  | { type: 'transcript_event'; sessionId: string; event: TranscriptEvent }
  | { type: 'resource'; snapshot: ResourceSnapshot }
  | {
      type: 'session_screenshot_captured'
      sessionId: string
      filename: string
      url: string
      capturedAt: string
    }
  | { type: 'memory_proposed'; memory: MemoryEntry }
  | { type: 'memory_updated'; memory: MemoryEntry }
  | { type: 'memory_reviewed'; memory: MemoryEntry }
  | { type: 'memory_deleted'; memoryId: number }

export type LimitSource = 'cgroup' | 'host'

export interface CpuSnapshot {
  usagePercent: number
  cpuCount: number
  source: LimitSource
}

export interface MemorySnapshot {
  usedBytes: number
  limitBytes: number
  rssBytes: number
  source: LimitSource
}

export interface DiskSnapshot {
  path: string
  usedBytes: number
  totalBytes: number
}

export interface CountsSnapshot {
  activeSessions: number
  maxSessions: number
  activeLoops: number
  maxLoops: number
}

export interface ResourceSnapshot {
  ts: number
  cpu: CpuSnapshot
  memory: MemorySnapshot
  disk: DiskSnapshot
  eventLoopLagMs: number
  counts: CountsSnapshot
}

export type OverrideFieldType = 'number' | 'boolean'
export type OverrideApply = 'live' | 'restart'
export type OverrideCategory = 'loops' | 'concurrency' | 'features'

export interface OverrideField {
  key: string
  label: string
  type: OverrideFieldType
  category: OverrideCategory
  apply: OverrideApply
  min?: number
  max?: number
  integer?: boolean
  description?: string
}

export interface LoopMeta {
  id: string
  name: string
  defaultIntervalMs: number
  defaultEnabled: boolean
}

export interface RuntimeOverridesSchema {
  fields: OverrideField[]
  loops: LoopMeta[]
}

export interface LoopOverride {
  enabled?: boolean
  intervalMs?: number
}

export interface RuntimeOverrides {
  loops?: Record<string, LoopOverride>
  workspace?: {
    maxConcurrentSessions?: number
  }
  loopsConfig?: {
    maxConcurrentLoops?: number
    reservedInteractiveSlots?: number
  }
  mcp?: {
    browserEnabled?: boolean
    githubEnabled?: boolean
    context7Enabled?: boolean
    sentryEnabled?: boolean
    supabaseEnabled?: boolean
    flyEnabled?: boolean
    zaiEnabled?: boolean
  }
  ci?: {
    babysitEnabled?: boolean
  }
  quota?: {
    retryMax?: number
    defaultSleepMs?: number
  }
}

export interface RuntimeConfigResponse {
  base: Record<string, unknown>
  overrides: RuntimeOverrides
  schema: RuntimeOverridesSchema
  requiresRestart?: string[]
}

export type MinionCommand =
  | { action: 'reply'; sessionId: string; message: string }
  | { action: 'stop'; sessionId: string }
  | { action: 'close'; sessionId: string }
  | { action: 'plan_action'; sessionId: string; planAction: PlanActionType; markdown?: string }
  | { action: 'ship_advance'; sessionId: string; to?: ShipStage }
  | { action: 'land'; dagId: string; nodeId: string }
  | { action: 'retry_rebase'; dagId: string; nodeId: string }
  | {
      action: 'submit_feedback'
      sessionId: string
      messageBlockId: string
      vote: FeedbackVote
      reason?: FeedbackReason
      comment?: string
    }

export interface RepoEntry {
  alias: string
  url: string
}

export interface VersionInfo {
  apiVersion: string
  libraryVersion: string
  features: string[]
  provider?: 'claude' | 'codex'
  repos?: RepoEntry[]
}

export type CreateSessionMode =
  | 'task'
  | 'dag-task'
  | 'plan'
  | 'think'
  | 'review'
  | 'ship'
  | 'rebase-resolver'

export interface CreateSessionRequest {
  prompt: string
  mode: CreateSessionMode
  repo?: string
  profileId?: string
  images?: Array<{ mediaType: string; dataBase64: string }>
}

export interface CreateSessionVariantsRequest extends CreateSessionRequest {
  count: number
}

export type CreateSessionVariantResult =
  | { sessionId: string; slug: string; threadId: number }
  | { error: string }

export interface CreateSessionVariantsResult {
  sessions: CreateSessionVariantResult[]
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

export interface WireWorkspaceDiff {
  base: string
  head: string
  patch: string
  truncated: boolean
}

export interface WorkspaceDiff {
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

export type ToolKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'search'
  | 'glob'
  | 'web_fetch'
  | 'web_search'
  | 'browser'
  | 'task'
  | 'todo'
  | 'notebook'
  | 'mcp'
  | 'other'

export type ToolResultStatus = 'ok' | 'error' | 'pending'

export type ToolResultFormat = 'text' | 'markdown' | 'diff' | 'json' | 'image'

export type StatusSeverity = 'info' | 'warn' | 'error'

export type TurnTrigger =
  | 'user_message'
  | 'agent_continuation'
  | 'command'
  | 'reply_injected'
  | 'resume'

export interface ToolCallSummary {
  toolUseId: string
  name: string
  kind: ToolKind
  title: string
  subtitle?: string
  input: Record<string, unknown>
  parentToolUseId?: string
}

export interface ToolResultPayload {
  status: ToolResultStatus
  text?: string
  truncated?: boolean
  originalBytes?: number
  format?: ToolResultFormat
  meta?: Record<string, unknown>
  error?: string
  images?: string[]
}

export interface TranscriptEventBase {
  seq: number
  id: string
  sessionId: string
  turn: number
  timestamp: number
}

export interface UserMessageEvent extends TranscriptEventBase {
  type: 'user_message'
  text: string
  images?: string[]
}

export interface TurnStartedEvent extends TranscriptEventBase {
  type: 'turn_started'
  trigger: TurnTrigger
}

export interface TurnCompletedEvent extends TranscriptEventBase {
  type: 'turn_completed'
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  errored?: boolean
}

export interface AssistantTextEvent extends TranscriptEventBase {
  type: 'assistant_text'
  blockId: string
  text: string
  final: boolean
}

export interface ThinkingEvent extends TranscriptEventBase {
  type: 'thinking'
  blockId: string
  text: string
  final: boolean
  signature?: string
}

export interface ToolCallEvent extends TranscriptEventBase {
  type: 'tool_call'
  call: ToolCallSummary
}

export interface ToolResultEvent extends TranscriptEventBase {
  type: 'tool_result'
  toolUseId: string
  result: ToolResultPayload
}

export interface StatusEvent extends TranscriptEventBase {
  type: 'status'
  severity: StatusSeverity
  kind: string
  message: string
  data?: Record<string, unknown>
}

export type TranscriptEvent =
  | UserMessageEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | AssistantTextEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent
  | StatusEvent

export type TranscriptEventType = TranscriptEvent['type']

export interface TranscriptSessionInfo {
  sessionId: string
  topicName?: string
  repo?: string
  mode?: string
  startedAt: number
  totalTokens?: number
  totalCostUsd?: number
  numTurns?: number
  active?: boolean
  transcriptUrl?: string
}

export interface TranscriptSnapshot {
  session: TranscriptSessionInfo
  events: TranscriptEvent[]
  highWaterMark: number
}

export function isTranscriptEventOfType<T extends TranscriptEventType>(
  event: TranscriptEvent,
  type: T,
): event is Extract<TranscriptEvent, { type: T }> {
  return event.type === type
}

export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference'
export type MemoryStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'pending_deletion'

export interface MemoryEntry {
  id: number
  repo: string | null
  kind: MemoryKind
  title: string
  body: string
  status: MemoryStatus
  sourceSessionId: string | null
  sourceDagId: string | null
  createdAt: number
  updatedAt: number
  supersededBy: number | null
  reviewedAt: number | null
  pinned: boolean
}

export interface CreateMemoryRequest {
  repo?: string | null
  kind: MemoryKind
  title: string
  body: string
  sourceSessionId?: string
  sourceDagId?: string
  pinned?: boolean
}

export interface UpdateMemoryRequest {
  title?: string
  body?: string
  kind?: MemoryKind
  status?: MemoryStatus
  pinned?: boolean
}

export interface ReviewMemoryRequest {
  status: 'approved' | 'rejected'
}
