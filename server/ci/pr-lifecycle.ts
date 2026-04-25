import type { Database } from 'bun:sqlite'
import type { EngineEventBus } from '../events/bus'
import { prepared } from '../db/sqlite'
import type { CIBabysitter, SessionMetadata } from '../handlers/types'
import type { EngineEventOfKind } from '../events/types'

const STRUCTURED_PR_LINE_RE = /^\s*PR:\s*<?(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+)>?\s*$/im
const PR_URL_RE = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g

interface SessionLifecycleRow {
  mode: string
  pr_url: string | null
  metadata: string
}

interface SessionMetadataWithCI extends SessionMetadata {
  ciBabysitStartedAt?: number
  ciBabysitTrigger?: 'stream' | 'completion'
}

interface DetectionResult {
  prUrl: string
  explicitPrLine: boolean
}

export interface PrLifecycleAction {
  mode: string
  explicitPrLine: boolean
  babysitClaimed: boolean
  parentThreadId?: string
  prUrl: string
}

export interface PrLifecycleWireOpts {
  bus: EngineEventBus
  db: Database
  ciBabysitter: CIBabysitter
  stopSession: (sessionId: string, reason?: string) => Promise<void>
}

function parseMetadata(raw: string): SessionMetadataWithCI {
  try {
    const parsed = JSON.parse(raw) as SessionMetadataWithCI
    if (parsed && typeof parsed === 'object') return parsed
    return {}
  } catch {
    return {}
  }
}

function detectPrUrl(text: string): DetectionResult | null {
  const lineMatch = text.match(STRUCTURED_PR_LINE_RE)
  if (lineMatch?.[1]) return { prUrl: lineMatch[1], explicitPrLine: true }

  const all = [...text.matchAll(PR_URL_RE)]
  if (all.length === 0) return null

  const last = all[all.length - 1]?.[0]
  if (!last) return null
  return { prUrl: last, explicitPrLine: false }
}

export function resolvePrLifecycleAction(
  db: Database,
  sessionId: string,
  assistantText: string,
): PrLifecycleAction | null {
  const detection = detectPrUrl(assistantText)
  if (!detection) return null

  let action: PrLifecycleAction | null = null
  const now = Date.now()

  db.transaction(() => {
    const row = db
      .query<SessionLifecycleRow, [string]>(
        'SELECT mode, pr_url, metadata FROM sessions WHERE id = ?',
      )
      .get(sessionId)

    if (!row) return

    if (row.pr_url !== detection.prUrl) {
      prepared.updateSession(db, {
        id: sessionId,
        pr_url: detection.prUrl,
        updated_at: now,
      })
    }

    const mode = row.mode
    if (mode !== 'task' && mode !== 'dag-task') {
      action = {
        mode,
        explicitPrLine: detection.explicitPrLine,
        babysitClaimed: false,
        prUrl: detection.prUrl,
      }
      return
    }

    const metadata = parseMetadata(row.metadata)
    if (metadata.ciBabysitStartedAt) {
      action = {
        mode,
        explicitPrLine: detection.explicitPrLine,
        babysitClaimed: false,
        parentThreadId: metadata.parentThreadId,
        prUrl: detection.prUrl,
      }
      return
    }

    metadata.ciBabysitStartedAt = now
    metadata.ciBabysitTrigger = 'stream'

    prepared.updateSession(db, {
      id: sessionId,
      metadata: { ...metadata },
      updated_at: now,
    })

    action = {
      mode,
      explicitPrLine: detection.explicitPrLine,
      babysitClaimed: true,
      parentThreadId: metadata.parentThreadId,
      prUrl: detection.prUrl,
    }
  })()

  return action
}

async function handleStreamEvent(
  event: EngineEventOfKind<'session.stream'>,
  opts: PrLifecycleWireOpts,
): Promise<void> {
  if (event.event.type !== 'assistant_text' || !event.event.final) return

  const action = resolvePrLifecycleAction(opts.db, event.sessionId, event.event.text)
  if (!action) return

  if (action.babysitClaimed) {
    if (action.parentThreadId) {
      void opts.ciBabysitter.queueDeferredBabysit(event.sessionId, action.parentThreadId)
    } else {
      void opts.ciBabysitter.babysitPR(event.sessionId, action.prUrl)
    }
  }

  if (action.explicitPrLine && (action.mode === 'task' || action.mode === 'dag-task')) {
    await opts.stopSession(event.sessionId, 'auto_exit_after_pr')
  }
}

export function wirePrLifecycle(opts: PrLifecycleWireOpts): () => void {
  return opts.bus.onKind('session.stream', (event) => {
    void handleStreamEvent(event, opts).catch((err: unknown) => {
      console.error(`[pr-lifecycle] failed for ${event.sessionId}:`, err)
    })
  })
}
