import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CapturedEntry {
  sessionId: string
  seq: number
  capturedAt: number
}

export interface DedupState {
  has(sessionId: string, seq: number): boolean
  maxSeq(sessionId: string): number
  remember(entry: CapturedEntry): void
}

export function loadDedupState(logPath: string): DedupState {
  const seen = new Set<string>()
  const maxBySession = new Map<string, number>()

  if (existsSync(logPath)) {
    const raw = readFileSync(logPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: CapturedEntry
      try {
        parsed = JSON.parse(trimmed) as CapturedEntry
      } catch {
        continue
      }
      const key = `${parsed.sessionId}:${parsed.seq}`
      seen.add(key)
      const prev = maxBySession.get(parsed.sessionId) ?? -1
      if (parsed.seq > prev) maxBySession.set(parsed.sessionId, parsed.seq)
    }
  } else {
    mkdirSync(dirname(logPath), { recursive: true })
  }

  return {
    has(sessionId, seq) {
      return seen.has(`${sessionId}:${seq}`)
    },
    maxSeq(sessionId) {
      return maxBySession.get(sessionId) ?? -1
    },
    remember(entry) {
      const key = `${entry.sessionId}:${entry.seq}`
      if (seen.has(key)) return
      seen.add(key)
      const prev = maxBySession.get(entry.sessionId) ?? -1
      if (entry.seq > prev) maxBySession.set(entry.sessionId, entry.seq)
      appendFileSync(logPath, JSON.stringify(entry) + '\n')
    },
  }
}
