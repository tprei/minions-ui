import type {
  ApiDagGraph,
  ApiSession,
  TranscriptSnapshot,
  VersionInfo,
} from '../../shared/api-types'

export interface DiffResponse {
  patch: string
  truncated: boolean
  base: string
}

export interface ApiClient {
  baseUrl: string
  listSessions(): Promise<ApiSession[]>
  listDags(): Promise<ApiDagGraph[]>
  getTranscript(slug: string, afterSeq?: number): Promise<TranscriptSnapshot>
  getDiff(slug: string): Promise<DiffResponse>
  getVersion(): Promise<VersionInfo>
}

export function createApiClient(baseUrl: string, token: string): ApiClient {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new ApiError(res.status, `${res.status} ${res.statusText}: ${text.slice(0, 200)}`)
    }
    const body = (await res.json()) as { data?: T; error?: string }
    if (body.error) throw new ApiError(res.status, body.error)
    if (body.data === undefined) throw new ApiError(res.status, 'response missing data field')
    return body.data
  }

  return {
    baseUrl,
    listSessions: () => get<ApiSession[]>('/api/sessions'),
    listDags: () => get<ApiDagGraph[]>('/api/dags'),
    getTranscript: (slug, afterSeq) => {
      const qs = afterSeq !== undefined ? `?after=${encodeURIComponent(String(afterSeq))}` : ''
      return get<TranscriptSnapshot>(`/api/sessions/${encodeURIComponent(slug)}/transcript${qs}`)
    },
    getDiff: (slug) => get<DiffResponse>(`/api/sessions/${encodeURIComponent(slug)}/diff`),
    getVersion: () => get<VersionInfo>('/api/version'),
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
  isNotFound(): boolean {
    return this.status === 404
  }
}
