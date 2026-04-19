import type { ReadonlySignal } from '@preact/signals'
import type { ApiDagGraph, ApiSession, CommandResult, MinionCommand, VersionInfo } from '../api/types'
import type { SseStatus } from '../api/sse'
import type { ApiClient } from '../api/client'

export type { ReadonlySignal }

export interface DiffStats {
  filesChanged: number
  insertions: number
  deletions: number
  truncated: boolean
}

export interface ConnectionStore {
  connectionId: string
  client: ApiClient
  sessions: ReadonlySignal<ApiSession[]>
  dags: ReadonlySignal<ApiDagGraph[]>
  status: ReadonlySignal<SseStatus>
  error: ReadonlySignal<string | null>
  version: ReadonlySignal<VersionInfo | null>
  stale: ReadonlySignal<boolean>
  diffStatsBySessionId: ReadonlySignal<Map<string, DiffStats>>
  loadDiffStats(sessionId: string): Promise<void>
  refresh(): Promise<void>
  sendCommand(cmd: MinionCommand): Promise<CommandResult>
  dispose(): void
}
