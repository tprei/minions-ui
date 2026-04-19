import type {
  ApiDagGraph,
  ApiResponse,
  ApiSession,
  CommandResult,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  CreateSessionVariantsResult,
  MinionCommand,
  PrPreview,
  PushSubscribeAck,
  PushSubscriptionJSON,
  ScreenshotList,
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
  sendMessage(text: string, sessionId?: string): Promise<{ ok: true; sessionId: string | null }>
  createSession(req: CreateSessionRequest): Promise<ApiSession>
  createSessionVariants(req: CreateSessionVariantsRequest): Promise<CreateSessionVariantsResult>
  getPr(sessionId: string): Promise<PrPreview>
  getDiff(sessionId: string): Promise<WorkspaceDiff>
  listScreenshots(sessionId: string): Promise<ScreenshotList>
  fetchScreenshotBlob(file: string): Promise<Blob>
  getVapidKey(): Promise<VapidPublicKey>
  subscribePush(sub: PushSubscriptionJSON): Promise<PushSubscribeAck>
  unsubscribePush(endpoint: string): Promise<{ ok: true }>
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

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers: headers() })
    const body = (await res.json()) as ApiResponse<T>
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
    const body = (await res.json()) as ApiResponse<T>
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
    const body = (await res.json()) as ApiResponse<T>
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

    sendMessage(text: string, sessionId?: string) {
      return post<{ ok: true; sessionId: string | null }>('/api/messages', { text, sessionId })
    },

    createSession(req: CreateSessionRequest) {
      return post<ApiSession>('/api/sessions', req)
    },

    createSessionVariants(req: CreateSessionVariantsRequest) {
      return post<CreateSessionVariantsResult>('/api/sessions/variants', req)
    },

    getPr(sessionId: string) {
      return get<PrPreview>(`/api/sessions/${encodeURIComponent(sessionId)}/pr`)
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

    async fetchScreenshotBlob(file: string): Promise<Blob> {
      const res = await fetch(`${baseUrl}/api/screenshots/${encodeURIComponent(file)}`, {
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

    openEventStream(handlers: SseHandlers): EventStreamHandle {
      return openEventStream({ baseUrl, token, handlers })
    },
  }
}
