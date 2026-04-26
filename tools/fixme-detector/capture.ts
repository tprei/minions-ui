import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ApiDagGraph,
  ApiSession,
  UserMessageEvent,
} from '../../shared/api-types'
import { ApiError, type ApiClient } from './api'

export const FIXME_RE = /(?:^|\s)#fixme(?:\(([^)]+)\))?(?::?\s+([\s\S]*))?/i

export interface FixmeMatch {
  scope: string | null
  body: string
}

export function matchFixme(text: string): FixmeMatch | null {
  const m = FIXME_RE.exec(text)
  if (!m) return null
  return {
    scope: m[1] ?? null,
    body: (m[2] ?? '').trim(),
  }
}

export interface Trigger {
  sessionId: string
  seq: number
  turn: number
  timestamp: number
  text: string
  tagBody: string
  scope: string | null
}

export interface SessionContext {
  slug: string
  branch: string | null
  prUrl: string | null
  mode: string
  repo: string | null
  stage: string | null
  attentionReasons: string[]
}

export interface MvrRecord {
  id: string
  trigger: Trigger
  session: SessionContext
  enrichment: {
    transcript: string
    dag: string
    diff: string
  }
  capturedAt: number
}

export function buildSessionContext(session: ApiSession | undefined): SessionContext {
  return {
    slug: session?.slug ?? '',
    branch: session?.branch ?? null,
    prUrl: session?.prUrl ?? null,
    mode: session?.mode ?? '',
    repo: session?.repo ?? null,
    stage: session?.stage ?? null,
    attentionReasons: session?.attentionReasons ?? [],
  }
}

export function buildTrigger(event: UserMessageEvent, match: FixmeMatch): Trigger {
  return {
    sessionId: event.sessionId,
    seq: event.seq,
    turn: event.turn,
    timestamp: event.timestamp,
    text: event.text,
    tagBody: match.body || event.text.trim(),
    scope: match.scope,
  }
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function isoForDirname(ts: number): string {
  const d = new Date(ts)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`
    + `-${pad(d.getUTCMilliseconds(), 3)}Z`
  )
}

function shortId(): string {
  return Math.random().toString(16).slice(2, 6) + Math.random().toString(16).slice(2, 6)
}

export function makeRecordId(trigger: Trigger, sessionSlug: string): string {
  const slug = sessionSlug || 'unknown'
  return `${isoForDirname(trigger.timestamp)}-${slug}-${shortId()}`
}

export function writeMvr(
  pendingRoot: string,
  trigger: Trigger,
  session: SessionContext,
): { dir: string; record: MvrRecord } {
  const id = makeRecordId(trigger, session.slug)
  const dir = join(pendingRoot, id)
  mkdirSync(dir, { recursive: true })
  const record: MvrRecord = {
    id,
    trigger,
    session,
    enrichment: { transcript: 'pending', dag: 'pending', diff: 'pending' },
    capturedAt: Date.now(),
  }
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record, null, 2))
  return { dir, record }
}

function updateRecord(dir: string, record: MvrRecord): void {
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record, null, 2))
}

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.isNotFound()) return 'missing'
  const msg = err instanceof Error ? err.message : String(err)
  return `error: ${msg}`
}

export async function enrichRecord(opts: {
  dir: string
  record: MvrRecord
  client: ApiClient
  dags: () => ApiDagGraph[]
}): Promise<MvrRecord> {
  const { dir, record, client, dags } = opts
  const slug = record.session.slug
  const sessionId = record.trigger.sessionId

  const transcriptPromise = slug
    ? client.getTranscript(slug).then(
        (snap) => {
          writeFileSync(join(dir, 'transcript.json'), JSON.stringify(snap, null, 2))
          return 'ok' as const
        },
        (err) => describeError(err),
      )
    : Promise.resolve('missing' as const)

  const dagPromise = (async () => {
    try {
      const all = dags()
      const associated = all.filter((g) =>
        Object.values(g.nodes).some((n) => n.session?.id === sessionId),
      )
      writeFileSync(join(dir, 'dag.json'), JSON.stringify(associated, null, 2))
      return associated.length > 0 ? 'ok' : 'missing'
    } catch (err) {
      return describeError(err)
    }
  })()

  const diffPromise = slug
    ? client.getDiff(slug).then(
        (diff) => {
          writeFileSync(join(dir, 'diff.patch'), diff.patch ?? '')
          return 'ok' as const
        },
        (err) => describeError(err),
      )
    : Promise.resolve('missing' as const)

  const [transcript, dag, diff] = await Promise.all([transcriptPromise, dagPromise, diffPromise])
  record.enrichment = { transcript, dag, diff }
  updateRecord(dir, record)
  writeFileSync(join(dir, 'summary.md'), renderSummary(record))
  return record
}

export function renderSummary(record: MvrRecord): string {
  const t = record.trigger
  const s = record.session
  const lines: string[] = []
  lines.push(`# fixme: ${t.tagBody || '(no body)'}`)
  lines.push('')
  lines.push(`- id: \`${record.id}\``)
  lines.push(`- captured: ${new Date(record.capturedAt).toISOString()}`)
  lines.push(`- session: \`${s.slug || t.sessionId}\` (${s.mode || 'unknown mode'})`)
  if (s.branch) lines.push(`- branch: \`${s.branch}\``)
  if (s.repo) lines.push(`- repo: \`${s.repo}\``)
  if (s.prUrl) lines.push(`- pr: ${s.prUrl}`)
  if (s.stage) lines.push(`- stage: ${s.stage}`)
  if (s.attentionReasons.length > 0) {
    lines.push(`- attention: ${s.attentionReasons.join(', ')}`)
  }
  if (t.scope) lines.push(`- scope: \`${t.scope}\``)
  lines.push('')
  lines.push('## trigger message')
  lines.push('')
  lines.push('```')
  lines.push(t.text)
  lines.push('```')
  lines.push('')
  lines.push('## enrichment')
  lines.push('')
  lines.push(`- transcript: ${record.enrichment.transcript}`)
  lines.push(`- dag: ${record.enrichment.dag}`)
  lines.push(`- diff: ${record.enrichment.diff}`)
  lines.push('')
  return lines.join('\n')
}
