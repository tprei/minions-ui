import type { ApiSession } from '../api/types'

export function isActive(status: ApiSession['status']): boolean {
  return status === 'running' || status === 'pending'
}

export function countRunning(sessions: readonly ApiSession[]): number {
  let n = 0
  for (const s of sessions) if (isActive(s.status)) n++
  return n
}

export function firstRunningId(sessions: readonly ApiSession[]): string | null {
  for (const s of sessions) if (isActive(s.status)) return s.id
  return null
}
