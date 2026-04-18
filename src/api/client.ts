import type { ApiDagGraph, ApiResponse, ApiSession, CommandResult, MinionCommand, VersionInfo } from './types'
import { openEventStream } from './sse'
import type { SseHandlers, EventStreamHandle } from './sse'

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

    openEventStream(handlers: SseHandlers): EventStreamHandle {
      return openEventStream({ baseUrl, token, handlers })
    },
  }
}
