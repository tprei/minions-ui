const DEFAULT_SLEEP_MS = 30 * 60 * 1000
const RESET_BUFFER_MS = 60 * 1000

const QUOTA_PATTERNS = [
  /usage.*limit/i,
  /rate.*limit/i,
  /quota.*exceeded/i,
  /out of.*usage/i,
  /hit.*(?:the|your|a)?\s*limit/i,
  /exceeded.*(?:the|your)?\s*(?:usage|rate|quota)/i,
  /usage.*(?:resets?|renews?)/i,
  /max.*(?:usage|tokens?).*(?:reached|exceeded)/i,
  /capacity.*(?:reached|exceeded|limit)/i,
  /too many requests/i,
  /plan.*(?:usage|limit).*(?:reached|exceeded)/i,
]

export function isQuotaError(text: string): boolean {
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text))
}

export function parseResetTime(text: string, now?: Date, defaultSleepMs?: number): number {
  const fallback = defaultSleepMs ?? DEFAULT_SLEEP_MS
  const ref = now ?? new Date()

  const parsed = tryParseAbsoluteTime(text, ref) ?? tryParseRelativeTime(text)

  if (parsed === null) return fallback

  return Math.max(parsed + RESET_BUFFER_MS, 60_000)
}

const ABSOLUTE_TIME_WITH_AMPM_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(UTC|utc)?\b/i
const ABSOLUTE_TIME_24H_UTC_RE = /\b(\d{1,2}):(\d{2})\s+(UTC|utc)\b/i

function tryParseAbsoluteTime(text: string, ref: Date): number | null {
  const ampmMatch = ABSOLUTE_TIME_WITH_AMPM_RE.exec(text)
  const utcMatch = ABSOLUTE_TIME_24H_UTC_RE.exec(text)
  const match = ampmMatch ?? utcMatch
  if (!match) return null

  let hours = parseInt(match[1] ?? '0', 10)
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  const ampm = ampmMatch ? match[3]?.toLowerCase() : undefined
  const isUtc = ampmMatch ? !!match[4] : true

  if (hours > 23 || minutes > 59) return null

  if (ampm === 'pm' && hours < 12) hours += 12
  if (ampm === 'am' && hours === 12) hours = 0

  const target = new Date(ref)
  if (isUtc) {
    target.setUTCHours(hours, minutes, 0, 0)
    if (target.getTime() <= ref.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1)
    }
  } else {
    target.setHours(hours, minutes, 0, 0)
    if (target.getTime() <= ref.getTime()) {
      target.setDate(target.getDate() + 1)
    }
  }

  return target.getTime() - ref.getTime()
}

const RELATIVE_TIME_RE = /\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i

function tryParseRelativeTime(text: string): number | null {
  const match = RELATIVE_TIME_RE.exec(text)
  if (!match) return null

  const value = parseInt(match[1] ?? '0', 10)
  const unit = (match[2] ?? '').toLowerCase()

  if (unit.startsWith('hour') || unit.startsWith('hr')) return value * 60 * 60 * 1000
  if (unit.startsWith('min')) return value * 60 * 1000
  if (unit.startsWith('sec')) return value * 1000

  return null
}
