import type { ReadonlySignal } from '@preact/signals'
import type { ApiDagGraph, ApiSession, CommandResult, MinionCommand, VersionInfo } from '../api/types'
import type { SseStatus } from '../api/sse'
import type { ApiClient } from '../api/client'

export type { ReadonlySignal }

export interface ConnectionStore {
  client: ApiClient
  sessions: ReadonlySignal<ApiSession[]>
  dags: ReadonlySignal<ApiDagGraph[]>
  status: ReadonlySignal<SseStatus>
  error: ReadonlySignal<string | null>
  version: ReadonlySignal<VersionInfo | null>
  refresh(): Promise<void>
  sendCommand(cmd: MinionCommand): Promise<CommandResult>
  dispose(): void
}
