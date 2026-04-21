import type { AttentionReason, QuickAction } from '../../shared/api-types'
import type { SessionRow } from '../db/sqlite'

const IDLE_LONG_THRESHOLD_MS = Number(process.env['IDLE_LONG_THRESHOLD_MS'] ?? 30 * 60 * 1000)

export function computeAttentionReasons(row: SessionRow, now: number): AttentionReason[] {
  const reasons: AttentionReason[] = []

  if (row.status === 'failed') {
    reasons.push('failed')
  }

  if (row.status === 'waiting_input') {
    reasons.push('waiting_for_feedback')
  }

  if (
    (row.status === 'running' || row.status === 'waiting_input') &&
    now - row.updated_at > IDLE_LONG_THRESHOLD_MS
  ) {
    reasons.push('idle_long')
  }

  const metadata = row.metadata as { pendingFeedback?: unknown; dagNodeId?: string }
  if (Array.isArray(metadata.pendingFeedback) && metadata.pendingFeedback.length > 0) {
    reasons.push('waiting_for_feedback')
  }

  return [...new Set(reasons)]
}

export function computeQuickActions(row: SessionRow): QuickAction[] {
  const actions: QuickAction[] = []

  if (row.status === 'running' || row.status === 'waiting_input') {
    actions.push({ type: 'retry', label: 'Stop', message: `/stop ${row.id}` })
  }

  if (row.status === 'failed') {
    actions.push({ type: 'retry', label: 'Retry', message: `/task ${row.command}` })
    actions.push({ type: 'resume', label: 'Resume', message: `/r continue` })
  }

  if (row.status === 'completed' || row.status === 'failed') {
    actions.push({ type: 'make_pr', label: 'Close', message: `/close ${row.id}` })
  }

  return actions
}
