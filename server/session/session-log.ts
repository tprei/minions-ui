import fs from 'node:fs'
import path from 'node:path'
import type { QualityReport } from '../handlers/types'

export type SessionLogState = 'completed' | 'errored' | 'quota_exhausted' | 'stream_stalled'

export interface SessionLogMeta {
  sessionId: string
  slug: string
  mode: string
  repo?: string
  branch?: string
  prUrl?: string
  startedAt: number
  totalTokens?: number
}

export interface SessionLog {
  sessionId: string
  slug: string
  mode: string
  state: SessionLogState
  startedAt: number
  endedAt: number
  durationMs: number
  totalTokens?: number
  repo?: string
  branch?: string
  prUrl?: string
  qualityReport?: QualityReport
  errorMessage?: string
}

export function writeSessionLog(
  cwd: string,
  meta: SessionLogMeta,
  state: SessionLogState,
  durationMs: number,
  qualityReport?: QualityReport,
  errorMessage?: string,
): void {
  const endedAt = Date.now()

  const entry: SessionLog = {
    sessionId: meta.sessionId,
    slug: meta.slug,
    mode: meta.mode,
    state,
    startedAt: meta.startedAt,
    endedAt,
    durationMs,
    ...(meta.totalTokens !== undefined ? { totalTokens: meta.totalTokens } : {}),
    ...(meta.repo !== undefined ? { repo: meta.repo } : {}),
    ...(meta.branch !== undefined ? { branch: meta.branch } : {}),
    ...(meta.prUrl !== undefined ? { prUrl: meta.prUrl } : {}),
    ...(qualityReport !== undefined ? { qualityReport } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }

  const filePath = path.join(cwd, 'session-log.json')
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8')
}
