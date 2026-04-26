import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ApiDagGraph,
  ApiSession,
  SseEvent,
  TranscriptEvent,
  UserMessageEvent,
} from '../../shared/api-types'
import { createApiClient, type ApiClient } from './api'
import {
  buildSessionContext,
  buildTrigger,
  enrichRecord,
  matchFixme,
  writeMvr,
} from './capture'
import { loadDedupState, type DedupState } from './dedup'
import { openEventStream } from './sse'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')
const FIXME_ROOT = join(REPO_ROOT, '.fixme')
const PENDING_DIR = join(FIXME_ROOT, 'pending')
const CAPTURED_LOG = join(FIXME_ROOT, '.captured.jsonl')

interface Config {
  baseUrl: string
  token: string
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  const raw = readFileSync(path, 'utf-8')
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function loadConfig(): Config {
  const dotenv = parseEnvFile(join(REPO_ROOT, 'docker', '.env'))
  const token = process.env['MINION_API_TOKEN'] ?? dotenv['MINION_API_TOKEN'] ?? ''
  if (!token) {
    throw new Error(
      'MINION_API_TOKEN not set; export it or add it to docker/.env before starting the detector',
    )
  }
  const port = process.env['ENGINE_PORT'] ?? dotenv['ENGINE_PORT'] ?? '8080'
  const baseUrl = process.env['MINION_API_URL'] ?? `http://localhost:${port}`
  return { baseUrl, token }
}

interface DetectorState {
  sessions: Map<string, ApiSession>
  dags: Map<string, ApiDagGraph>
  seenSeq: Map<string, number>
  dedup: DedupState
  client: ApiClient
}

function ts(): string {
  return new Date().toISOString()
}

function log(...args: unknown[]): void {
  console.log(`[${ts()}]`, ...args)
}

async function captureFixme(
  state: DetectorState,
  event: UserMessageEvent,
  source: 'sse' | 'gap-fill',
): Promise<void> {
  const match = matchFixme(event.text)
  if (!match) return
  if (state.dedup.has(event.sessionId, event.seq)) return

  const trigger = buildTrigger(event, match)
  const session = state.sessions.get(event.sessionId)
  const sessionCtx = buildSessionContext(session)
  const { dir, record } = writeMvr(PENDING_DIR, trigger, sessionCtx)
  state.dedup.remember({
    sessionId: event.sessionId,
    seq: event.seq,
    capturedAt: record.capturedAt,
  })
  log(`captured #fixme (${source})`, {
    id: record.id,
    sessionId: event.sessionId,
    slug: sessionCtx.slug,
    seq: event.seq,
  })

  try {
    const enriched = await enrichRecord({
      dir,
      record,
      client: state.client,
      dags: () => Array.from(state.dags.values()),
    })
    log('enriched', { id: record.id, enrichment: enriched.enrichment })
  } catch (err) {
    log('enrichment failed', {
      id: record.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function trackSeq(state: DetectorState, sessionId: string, seq: number): void {
  const prev = state.seenSeq.get(sessionId) ?? -1
  if (seq > prev) state.seenSeq.set(sessionId, seq)
}

function handleTranscriptEvent(state: DetectorState, sessionId: string, event: TranscriptEvent) {
  trackSeq(state, sessionId, event.seq)
  if (event.type !== 'user_message') return
  void captureFixme(state, event, 'sse')
}

function handleSseEvent(state: DetectorState, sse: SseEvent): void {
  if (sse.type === 'session_created' || sse.type === 'session_updated') {
    state.sessions.set(sse.session.id, sse.session)
    return
  }
  if (sse.type === 'session_deleted') {
    state.sessions.delete(sse.sessionId)
    return
  }
  if (sse.type === 'dag_created' || sse.type === 'dag_updated') {
    state.dags.set(sse.dag.id, sse.dag)
    return
  }
  if (sse.type === 'dag_deleted') {
    state.dags.delete(sse.dagId)
    return
  }
  if (sse.type === 'transcript_event') {
    handleTranscriptEvent(state, sse.sessionId, sse.event)
  }
}

async function gapFill(state: DetectorState): Promise<void> {
  log('running gap-fill scan')
  let sessions: ApiSession[]
  try {
    sessions = await state.client.listSessions()
  } catch (err) {
    log('gap-fill list sessions failed', err instanceof Error ? err.message : String(err))
    return
  }

  for (const session of sessions) {
    state.sessions.set(session.id, session)
    const after = state.seenSeq.get(session.id) ?? state.dedup.maxSeq(session.id)
    let snapshot
    try {
      snapshot = await state.client.getTranscript(session.slug, after)
    } catch (err) {
      log('gap-fill transcript failed', {
        slug: session.slug,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    for (const event of snapshot.events) {
      trackSeq(state, session.id, event.seq)
      if (event.type !== 'user_message') continue
      await captureFixme(state, event, 'gap-fill')
    }
  }

  try {
    const dags = await state.client.listDags()
    state.dags.clear()
    for (const dag of dags) state.dags.set(dag.id, dag)
  } catch (err) {
    log('gap-fill list dags failed', err instanceof Error ? err.message : String(err))
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const client = createApiClient(config.baseUrl, config.token)
  const dedup = loadDedupState(CAPTURED_LOG)

  const state: DetectorState = {
    sessions: new Map(),
    dags: new Map(),
    seenSeq: new Map(),
    dedup,
    client,
  }

  log('starting fixme-detector', {
    baseUrl: config.baseUrl,
    pendingDir: PENDING_DIR,
  })

  await gapFill(state)

  const handle = openEventStream({
    baseUrl: config.baseUrl,
    token: config.token,
    handlers: {
      onEvent: (e) => handleSseEvent(state, e),
      onStatusChange: (s) => log('sse status', s),
      onReconnect: () => {
        void gapFill(state)
      },
    },
  })

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`)
    handle.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
