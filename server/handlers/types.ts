import type { Database } from 'bun:sqlite'
import type { EngineEventBus } from '../events/bus'
import type { EngineEventOfKind } from '../events/types'
import type { SessionRegistry } from '../session/registry'

export type SessionCompletedEvent = EngineEventOfKind<'session.completed'>
export type { SessionRunState } from '../events/types'

export interface CompletionHandler {
  readonly name: string
  readonly priority: number
  matches(ev: SessionCompletedEvent): boolean
  handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void>
}

export interface DagScheduler {
  onSessionCompleted(sessionId: string, state: string): Promise<void>
  start(dagId: string): Promise<void>
}

export interface LoopScheduler {
  recordOutcome(loopId: string, state: string): Promise<void>
}

export interface QualityReport {
  allPassed: boolean
  results: Array<{ name: string; passed: boolean; output: string }>
}

export interface QualityGates {
  run(cwd: string): Promise<QualityReport>
}

export interface DigestBuilder {
  build(sessionId: string, db: Database): Promise<string>
}

export interface CIBabysitter {
  babysitPR(sessionId: string, prUrl: string, qualityReport?: QualityReport): Promise<void>
  queueDeferredBabysit(sessionId: string, parentThreadId: string): Promise<void>
  babysitDagChildCI(sessionId: string, prUrl: string): Promise<void>
}

export interface ProfileStore {
  get(id: string): Record<string, unknown> | undefined
}

export interface ReplyQueue {
  pending(): Promise<string[]>
  drain(): Promise<string[]>
}

export interface ReplyQueueFactory {
  forSession(sessionId: string): ReplyQueue
}

export interface MinionConfig {
  quotaRetryMax: number
}

export interface HandlerCtx {
  db: Database
  registry: SessionRegistry
  bus: EngineEventBus
  scheduler: DagScheduler
  loopScheduler: LoopScheduler
  ciBabysitter: CIBabysitter
  qualityGates: QualityGates
  digest: DigestBuilder
  profileStore: ProfileStore
  replyQueue: ReplyQueueFactory
  config: MinionConfig
}

export interface SessionMetaRow {
  id: string
  slug: string
  mode: string
  repo: string | null
  metadata: string | null
  pipeline_advancing: number | null
  quota_sleep_until: number | null
  quota_retry_count: number | null
}

export interface SessionMetadata {
  loopId?: string
  dagId?: string
  dagNodeId?: string
  parentThreadId?: string
  pendingFeedback?: string[]
  ciBabysitStartedAt?: number
  ciBabysitTrigger?: 'stream' | 'completion'
  parentBranch?: string
  parentSha?: string
  resolverAttemptKey?: string
}
