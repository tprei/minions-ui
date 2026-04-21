export type SessionMode = "task" | "plan" | "think" | "review" | "ci-fix" | "dag-review" | "ship-think" | "ship-plan" | "ship-verify"

export interface SessionMeta {
  sessionId: string
  threadId: number
  topicName: string
  repo: string
  cwd: string
  startedAt: number
  totalTokens?: number
  totalCostUsd?: number
  numTurns?: number
  mode: SessionMode
  screenshotDir?: string
}

export type SessionDoneState = "completed" | "errored" | "quota_exhausted"
export type SessionState = "spawning" | "working" | "idle" | "completed" | "errored"

export interface SessionPort {
  readonly meta: SessionMeta
  start(task: string, systemPrompt?: string): void
  injectReply(text: string, images?: string[]): boolean
  waitForCompletion(): Promise<SessionDoneState>
  isClosed(): boolean
  getState(): SessionState
  isActive(): boolean
  interrupt(): void
  kill(gracefulMs?: number): Promise<void>
}

export interface TopicMessage {
  role: "user" | "assistant"
  text: string
  images?: string[]
}

export interface PendingDagItem {
  id: string
  title: string
  description: string
  dependsOn: string[]
}

export type ShipPhase = "think" | "plan" | "judge" | "dag" | "verify" | "done"

export interface AutoAdvance {
  phase: ShipPhase
  featureDescription: string
  autoLand: boolean
}

export type VerificationCheckKind = "quality-gates" | "ci" | "completeness-review"
export type VerificationCheckStatus = "pending" | "running" | "passed" | "failed" | "skipped"

export interface VerificationCheck {
  kind: VerificationCheckKind
  status: VerificationCheckStatus
  nodeId: string
  output?: string
  startedAt?: number
  finishedAt?: number
}

export interface VerificationRound {
  round: number
  checks: VerificationCheck[]
  startedAt: number
  finishedAt?: number
}

export interface VerificationState {
  dagId: string
  maxRounds: number
  rounds: VerificationRound[]
  status: "running" | "passed" | "failed"
}

export interface TopicSession {
  threadId: number
  repo: string
  repoUrl?: string
  cwd: string
  slug: string
  topicHandle?: string
  conversation: TopicMessage[]
  activeSessionId?: string
  pendingFeedback: string[]
  mode: SessionMode
  lastActivityAt: number
  profileId?: string
  parentThreadId?: number
  childThreadIds?: number[]
  splitLabel?: string
  interruptedAt?: number
  branch?: string
  prUrl?: string
  lastState?: "completed" | "errored" | "quota_exhausted"
  dagId?: string
  dagNodeId?: string
  pendingSplitItems?: { title: string; description: string }[]
  allSplitItems?: { title: string; description: string }[]
  pinnedMessageId?: number
  pendingDagItems?: PendingDagItem[]
  quotaRetryCount?: number
  quotaSleepUntil?: number
  autoAdvance?: AutoAdvance
  verificationState?: VerificationState
  loopId?: string
  pipelineAdvancing?: boolean
  isIdle?: boolean
}

export type DagNodeStatus = "pending" | "ready" | "running" | "done" | "failed" | "skipped" | "ci-pending" | "ci-failed" | "landed"

export interface DagNode {
  id: string
  title: string
  description: string
  dependsOn: string[]
  status: DagNodeStatus
  threadId?: number
  branch?: string
  prUrl?: string
  error?: string
  recoveryAttempted?: boolean
  mergeBase?: string
  baseSha?: string
  headSha?: string
  prCommentId?: number
}

export interface DagGraph {
  id: string
  nodes: DagNode[]
  parentThreadId: number
  repoUrl?: string
  repo?: string
  createdAt?: number
  isStack?: boolean
}

export interface DagInput {
  id: string
  title: string
  description: string
  dependsOn: string[]
}

export interface ActiveSession {
  handle: SessionPort
  meta: SessionMeta
  task: string
}

export interface PendingTask {
  task: string
  threadId?: number
  repoSlug?: string
  repoUrl?: string
  mode: "task" | "plan" | "think" | "review" | "ship-think"
  autoAdvance?: AutoAdvance
}

export interface MergeResult {
  ok: boolean
  conflictFiles: string[]
}

export interface SessionConfig {
  claude: Record<string, unknown>
  mcp: Record<string, unknown>
  profile?: Record<string, unknown>
  sessionEnvPassthrough?: string[]
  agentDefs?: Record<string, unknown>
}

export type AgentStreamEvent = Record<string, unknown>

export type SessionEventCallback = (event: AgentStreamEvent) => void
export type SessionDoneCallback = (meta: SessionMeta, state: SessionDoneState) => void
export type TextCaptureCallback = (sessionId: string, text: string) => void

export interface Observer {
  onSessionStart(
    meta: SessionMeta,
    task: string,
    onTextCapture: TextCaptureCallback,
    onDeadThread: () => void,
  ): Promise<void>
  onEvent(meta: SessionMeta, event: AgentStreamEvent): Promise<void>
  onSessionComplete(meta: SessionMeta, finalState: SessionDoneState, durationMs: number): Promise<void>
  flush(): Promise<void>
}

export interface EngineContext {
  readonly config: {
    claude: Record<string, unknown>
    mcp: Record<string, unknown>
    workspace: {
      sessionTimeoutMs: number
      sessionInactivityTimeoutMs: number
    }
    sessionEnvPassthrough?: string[]
    agentDefs?: Record<string, unknown>
  }
  readonly notifier: {
    send(text: string, threadId?: number): Promise<{ ok: boolean; messageId: number | null }>
  }
  readonly observer: Observer
  readonly profileStore: {
    get(id: string): Record<string, unknown> | undefined
  }
  readonly sessions: Map<number, ActiveSession>
  readonly topicSessions: Map<number, TopicSession>
  readonly dags: Map<string, DagGraph>
  spawnTopicAgent(topicSession: TopicSession, task: string): Promise<boolean>
  pushToConversation(session: TopicSession, message: TopicMessage): void
  postStatus(topicSession: TopicSession, html: string, opts?: Record<string, unknown>): Promise<{ ok: boolean; messageId: unknown }>
  persistTopicSessions(markInterrupted?: boolean): Promise<void>
  persistDags(): Promise<void>
  updateTopicTitle(topicSession: TopicSession, stateEmoji: string): Promise<void>
  startDag(topicSession: TopicSession, items: DagInput[], isStack: boolean): Promise<void>
  handleLandCommand(topicSession: TopicSession): Promise<void>
  handleDeadThread(topicSession: TopicSession, threadId: number): void
  handleExecuteCommand(topicSession: TopicSession, directive?: string): Promise<void>
}
