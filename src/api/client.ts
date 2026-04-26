import type {
  ApiDagGraph,
  ApiResponse,
  ApiSession,
  AuditEvent,
  CommandResult,
  CreateExternalTaskRequest,
  ExternalTaskResult,
  CreateMemoryRequest,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  CreateSessionVariantsResult,
  MemoryEntry,
  MergeReadiness,
  MinionCommand,
  PrPreview,
  PushSubscribeAck,
  PushSubscriptionJSON,
  ReadinessSummary,
  ResourceSnapshot,
  ReviewMemoryRequest,
  RestoreCheckpointResult,
  RuntimeConfigResponse,
  RuntimeOverrides,
  SessionCheckpoint,
  ScreenshotList,
  TranscriptSnapshot,
  UpdateMemoryRequest,
  VapidPublicKey,
  VersionInfo,
  WireWorkspaceDiff,
  WorkspaceDiff,
} from './types'
import { openEventStream } from './sse'
import type { SseHandlers, EventStreamHandle } from './sse'
import { computeDiffStats } from './diff-stats'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClient {
  getVersion(): Promise<VersionInfo>
  getSessions(): Promise<ApiSession[]>
  getDags(): Promise<ApiDagGraph[]>
  sendCommand(cmd: MinionCommand): Promise<CommandResult>
  sendMessage(text: string, sessionId?: string, images?: Array<{ mediaType: string; dataBase64: string }>): Promise<{ ok: true; sessionId: string | null }>
  createSession(req: CreateSessionRequest): Promise<ApiSession>
  createSessionVariants(req: CreateSessionVariantsRequest): Promise<CreateSessionVariantsResult>
  createExternalTask(req: CreateExternalTaskRequest): Promise<ExternalTaskResult>
  getPr(sessionId: string): Promise<PrPreview>
  getReadiness(sessionId: string): Promise<MergeReadiness>
  getReadinessSummary(): Promise<ReadinessSummary>
  getAuditEvents(limit?: number): Promise<AuditEvent[]>
  listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]>
  restoreCheckpoint(sessionId: string, checkpointId: string): Promise<RestoreCheckpointResult>
  getDiff(sessionId: string): Promise<WorkspaceDiff>
  getTranscript(slug: string, afterSeq?: number): Promise<TranscriptSnapshot>
  listScreenshots(sessionId: string): Promise<ScreenshotList>
  fetchScreenshotBlob(url: string): Promise<Blob>
  getVapidKey(): Promise<VapidPublicKey>
  subscribePush(sub: PushSubscriptionJSON): Promise<PushSubscribeAck>
  unsubscribePush(endpoint: string): Promise<{ ok: true }>
  getMetrics(): Promise<ResourceSnapshot>
  getRuntimeConfig(): Promise<RuntimeConfigResponse>
  patchRuntimeConfig(patch: RuntimeOverrides): Promise<RuntimeConfigResponse>
  getMemories(query?: string, status?: string): Promise<MemoryEntry[]>
  createMemory(req: CreateMemoryRequest): Promise<MemoryEntry>
  updateMemory(id: number, req: UpdateMemoryRequest): Promise<MemoryEntry>
  reviewMemory(id: number, req: ReviewMemoryRequest): Promise<MemoryEntry>
  deleteMemory(id: number): Promise<{ ok: true }>
  openEventStream(handlers: SseHandlers): EventStreamHandle
  baseUrl: string
  token: string
}

export function createApiClient(opts: { baseUrl: string; token: string }): ApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const { token } = opts

  function headers(): HeadersInit {
    if (!token) return { 'Content-Type': 'application/json' }
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  function authHeadersOnly(): HeadersInit {
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }

  async function readBody<T>(res: Response): Promise<ApiResponse<T>> {
    try {
      return (await res.json()) as ApiResponse<T>
    } catch {
      throw new ApiError(res.status, res.statusText || 'Invalid JSON response')
    }
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers: headers() })
    const body = await readBody<T>(res)
    if (!res.ok || body.error) {
      throw new ApiError(res.status, body.error ?? res.statusText)
    }
    return body.data
  }

  async function post<T>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(data),
    })
    const body = await readBody<T>(res)
    if (!res.ok || body.error) {
      throw new ApiError(res.status, body.error ?? res.statusText)
    }
    return body.data
  }

  async function patch<T>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(data),
    })
    const body = await readBody<T>(res)
    if (!res.ok || body.error) {
      throw new ApiError(res.status, body.error ?? res.statusText)
    }
    return body.data
  }

  async function del<T>(path: string, data?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'DELETE',
      headers: headers(),
      body: data !== undefined ? JSON.stringify(data) : undefined,
    })
    const body = await readBody<T>(res)
    if (!res.ok || body.error) {
      throw new ApiError(res.status, body.error ?? res.statusText)
    }
    return body.data
  }

  return {
    baseUrl,
    token,

    getVersion() {
      return get<VersionInfo>('/api/version')
    },

    getSessions() {
      return get<ApiSession[]>('/api/sessions')
    },

    getDags() {
      return get<ApiDagGraph[]>('/api/dags')
    },

    sendCommand(cmd: MinionCommand) {
      return post<CommandResult>('/api/commands', cmd)
    },

    sendMessage(text: string, sessionId?: string, images?: Array<{ mediaType: string; dataBase64: string }>) {
      return post<{ ok: true; sessionId: string | null }>('/api/messages', { text, sessionId, images })
    },

    createSession(req: CreateSessionRequest) {
      return post<ApiSession>('/api/sessions', req)
    },

    createSessionVariants(req: CreateSessionVariantsRequest) {
      return post<CreateSessionVariantsResult>('/api/sessions/variants', req)
    },

    createExternalTask(req: CreateExternalTaskRequest) {
      return post<ExternalTaskResult>('/api/entrypoints', req)
    },

    getPr(sessionId: string) {
      return get<PrPreview>(`/api/sessions/${encodeURIComponent(sessionId)}/pr`)
    },

    getReadiness(sessionId: string) {
      return get<MergeReadiness>(`/api/sessions/${encodeURIComponent(sessionId)}/readiness`)
    },

    getReadinessSummary() {
      return get<ReadinessSummary>('/api/readiness/summary')
    },

    getAuditEvents(limit?: number) {
      const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : ''
      return get<AuditEvent[]>(`/api/audit/events${query}`)
    },

    listCheckpoints(sessionId: string) {
      return get<SessionCheckpoint[]>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`)
    },

    restoreCheckpoint(sessionId: string, checkpointId: string) {
      return post<RestoreCheckpointResult>(
        `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
        {},
      )
    },

    async getDiff(sessionId: string): Promise<WorkspaceDiff> {
      const raw = await get<WireWorkspaceDiff>(`/api/sessions/${encodeURIComponent(sessionId)}/diff`)
      return {
        branch: raw.head,
        baseBranch: raw.base,
        patch: raw.patch,
        truncated: raw.truncated,
        stats: computeDiffStats(raw.patch),
      }
    },

    listScreenshots(sessionId: string) {
      return get<ScreenshotList>(`/api/sessions/${encodeURIComponent(sessionId)}/screenshots`)
    },

    getTranscript(slug: string, afterSeq?: number) {
      const query = afterSeq !== undefined ? `?after=${encodeURIComponent(String(afterSeq))}` : ''
      return get<TranscriptSnapshot>(`/api/sessions/${encodeURIComponent(slug)}/transcript${query}`)
    },

    async fetchScreenshotBlob(url: string): Promise<Blob> {
      const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
      const res = await fetch(fullUrl, {
        headers: authHeadersOnly(),
      })
      if (!res.ok) {
        throw new ApiError(res.status, res.statusText)
      }
      return res.blob()
    },

    getVapidKey() {
      return get<VapidPublicKey>('/api/push/vapid-public-key')
    },

    subscribePush(sub: PushSubscriptionJSON) {
      return post<PushSubscribeAck>('/api/push-subscribe', sub)
    },

    unsubscribePush(endpoint: string) {
      return del<{ ok: true }>('/api/push-subscribe', { endpoint })
    },

    getMetrics() {
      return get<ResourceSnapshot>('/api/metrics')
    },

    getRuntimeConfig() {
      return get<RuntimeConfigResponse>('/api/config/runtime')
    },

    patchRuntimeConfig(patchBody: RuntimeOverrides) {
      return patch<RuntimeConfigResponse>('/api/config/runtime', patchBody)
    },

    getMemories(query?: string, status?: string) {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (status) params.set('status', status)
      const qs = params.toString()
      return get<MemoryEntry[]>(`/api/memories${qs ? `?${qs}` : ''}`)
    },

    createMemory(req: CreateMemoryRequest) {
      return post<MemoryEntry>('/api/memories', req)
    },

    updateMemory(id: number, req: UpdateMemoryRequest) {
      return patch<MemoryEntry>(`/api/memories/${id}`, req)
    },

    reviewMemory(id: number, req: ReviewMemoryRequest) {
      return post<MemoryEntry>(`/api/memories/${id}/review`, req)
    },

    deleteMemory(id: number) {
      return del<{ ok: true }>(`/api/memories/${id}`)
    },

    openEventStream(handlers: SseHandlers): EventStreamHandle {
      return openEventStream({ baseUrl, token, handlers })
    },
  }
}
