import type { EngineEventBus } from '../events/bus'
import type { SessionRow } from '../db/sqlite'
import { computeAttentionReasons, computeQuickActions } from '../api/attention'
import type { ApiSession, AttentionReason, ConversationMessage } from '../../shared/api-types'

export interface AttentionEmitOpts {
  bus: EngineEventBus
  getDb: () => import('bun:sqlite').Database
}

const DEDUP_WINDOW_MS = 5 * 60 * 1000

const lastEmitted = new Map<string, { at: number; reasons: string }>()

function reasonsKey(reasons: AttentionReason[]): string {
  return [...reasons].sort().join(',')
}

function rowToAttentionSession(row: SessionRow, reasons: AttentionReason[]): ApiSession {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status === 'waiting_input' ? 'running' : row.status,
    command: row.command,
    mode: row.mode,
    repo: row.repo ?? undefined,
    branch: row.branch ?? undefined,
    prUrl: row.pr_url ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    parentId: row.parent_id ?? undefined,
    childIds: [],
    needsAttention: true,
    attentionReasons: reasons,
    quickActions: computeQuickActions(row),
    conversation: row.conversation as ConversationMessage[],
    variantGroupId: row.variant_group_id ?? undefined,
  }
}

export function maybeEmitAttention(row: SessionRow, opts: AttentionEmitOpts): void {
  const now = Date.now()
  const reasons = computeAttentionReasons(row, now)
  if (reasons.length === 0) return

  const key = row.id
  const prev = lastEmitted.get(key)
  const newKey = reasonsKey(reasons)

  if (prev && now - prev.at < DEDUP_WINDOW_MS && prev.reasons === newKey) return

  lastEmitted.set(key, { at: now, reasons: newKey })

  const db = opts.getDb()
  db.run(
    'UPDATE sessions SET metadata = json_patch(metadata, json(?)) WHERE id = ?',
    [JSON.stringify({ attention_last_emitted_at: now }), row.id],
  )

  opts.bus.emit({ kind: 'session.snapshot', session: rowToAttentionSession(row, reasons) })
}

export function clearAttentionCache(): void {
  lastEmitted.clear()
}
