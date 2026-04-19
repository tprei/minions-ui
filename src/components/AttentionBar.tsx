import type { ApiSession, AttentionReason } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { ATTENTION_CONFIG } from './shared'

const REASON_ORDER: AttentionReason[] = [
  'failed',
  'waiting_for_feedback',
  'interrupted',
  'ci_fix',
  'idle_long',
]

export type AttentionCounts = Record<AttentionReason, number>

export function countByAttentionReason(sessions: ApiSession[]): AttentionCounts {
  const counts: AttentionCounts = {
    failed: 0,
    waiting_for_feedback: 0,
    interrupted: 0,
    ci_fix: 0,
    idle_long: 0,
  }
  for (const s of sessions) {
    if (!s.needsAttention) continue
    for (const r of s.attentionReasons) {
      if (r in counts) counts[r] += 1
    }
  }
  return counts
}

export function firstSessionWithReason(
  sessions: ApiSession[],
  reason: AttentionReason,
): ApiSession | null {
  const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return (
    sorted.find((s) => s.needsAttention && s.attentionReasons.includes(reason)) ?? null
  )
}

export function filterSessionsByReason(
  sessions: ApiSession[],
  reason: AttentionReason | null,
): ApiSession[] {
  if (reason === null) return sessions
  return sessions.filter((s) => s.needsAttention && s.attentionReasons.includes(reason))
}

interface AttentionBarProps {
  sessions: ApiSession[]
  filter: AttentionReason | null
  onSelect: (reason: AttentionReason | null, firstMatchId: string | null) => void
}

export function AttentionBar({ sessions, filter, onSelect }: AttentionBarProps) {
  const theme = useTheme()
  const dark = theme.value === 'dark'
  const counts = countByAttentionReason(sessions)
  const total = REASON_ORDER.reduce((t, r) => t + counts[r], 0)

  if (total === 0) return null

  return (
    <div
      class="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      data-testid="attention-bar"
      role="toolbar"
      aria-label="Sessions needing attention"
    >
      <span class="shrink-0 text-[11px] uppercase tracking-wide font-medium text-slate-500 dark:text-slate-400 mr-1">
        Needs attention
      </span>
      {REASON_ORDER.map((reason) => {
        const count = counts[reason]
        if (count === 0) return null
        const config = ATTENTION_CONFIG[reason]
        const tone = dark ? config.darkClassName : config.className
        const isActive = filter === reason
        const ring = isActive
          ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 shadow-sm'
          : 'ring-0 opacity-80 hover:opacity-100'
        const handleClick = () => {
          if (isActive) {
            onSelect(null, null)
            return
          }
          const first = firstSessionWithReason(sessions, reason)
          onSelect(reason, first?.id ?? null)
        }
        return (
          <button
            key={reason}
            type="button"
            onClick={handleClick}
            aria-pressed={isActive}
            title={`${count} ${count === 1 ? 'session' : 'sessions'} — ${config.label}`}
            data-testid={`attention-pill-${reason}`}
            class={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all ${tone} ${ring}`}
          >
            <span aria-hidden>{config.emoji}</span>
            <span>{config.label}</span>
            <span class="ml-0.5 tabular-nums font-semibold">{count}</span>
          </button>
        )
      })}
      {filter !== null && (
        <button
          type="button"
          onClick={() => onSelect(null, null)}
          class="shrink-0 ml-auto text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline"
          data-testid="attention-clear"
        >
          Clear filter
        </button>
      )}
    </div>
  )
}
