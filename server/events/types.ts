import type { TranscriptEvent, ApiSession, ApiDagGraph, ResourceSnapshot, ApiMemory } from '../../shared/api-types'

export type SessionRunState = 'completed' | 'errored' | 'quota_exhausted' | 'stream_stalled'

export type EngineEvent =
  | { kind: 'session.spawning'; sessionId: string; mode: string; cwd: string }
  | { kind: 'session.started'; sessionId: string; pid: number; claudeSessionId?: string }
  | { kind: 'session.stream'; sessionId: string; event: TranscriptEvent }
  | { kind: 'session.idle'; sessionId: string }
  | { kind: 'session.reply_injected'; sessionId: string; chars: number; imageCount: number }
  | { kind: 'session.quota_sleep'; sessionId: string; resetAt: number; retryCount: number; retryMax: number }
  | { kind: 'session.resumed'; sessionId: string; retryCount: number }
  | { kind: 'session.stalled'; sessionId: string; sinceMs: number }
  | {
      kind: 'session.completed'
      sessionId: string
      state: SessionRunState
      durationMs: number
      totalTokens?: number
      totalCostUsd?: number
    }
  | { kind: 'session.snapshot'; session: ApiSession }
  | { kind: 'session.deleted'; sessionId: string }
  | { kind: 'dag.node.queued'; dagId: string; nodeId: string; dependsOn: string[] }
  | { kind: 'dag.node.started'; dagId: string; nodeId: string; sessionId: string }
  | {
      kind: 'dag.node.completed'
      dagId: string
      nodeId: string
      sessionId: string
      state: 'completed' | 'errored' | 'quota_exhausted'
    }
  | { kind: 'dag.snapshot'; dag: ApiDagGraph }
  | { kind: 'dag.deleted'; dagId: string }
  | { kind: 'dag.node.landed'; dagId: string; nodeId: string }
  | { kind: 'session.assistant_activity'; sessionId: string; toolName: string; toolUseId: string }
  | {
      kind: 'session.screenshot_captured'
      sessionId: string
      filename: string
      absolutePath: string
      relativeUrl: string
      capturedAt: string
    }
  | { kind: 'session.mode_completed'; sessionId: string; mode: string; state: SessionRunState; durationMs: number }
  | {
      kind: 'session.quality_gates'
      sessionId: string
      allPassed: boolean
      results: Array<{ name: string; passed: boolean; output: string }>
    }
  | { kind: 'resource'; snapshot: ResourceSnapshot }
  | { kind: 'memory.proposed'; memory: ApiMemory }
  | { kind: 'memory.updated'; memory: ApiMemory }
  | { kind: 'memory.reviewed'; memory: ApiMemory }
  | { kind: 'memory.deleted'; memoryId: string }

export type EngineEventKind = EngineEvent['kind']
export type EngineEventOfKind<K extends EngineEventKind> = Extract<EngineEvent, { kind: K }>
