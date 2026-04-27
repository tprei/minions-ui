import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { ApiSession, AttentionReason } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { useMediaQuery } from '../hooks/useMediaQuery'
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
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const open = useSignal(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const counts = countByAttentionReason(sessions)
  const total = REASON_ORDER.reduce((t, r) => t + counts[r], 0)

  useEffect(() => {
    if (!open.value || isDesktop.value) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        open.value = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open.value, isDesktop.value, open])

  if (total === 0) return null

  const renderPill = (reason: AttentionReason, closeOnSelect: boolean) => {
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
        if (closeOnSelect) open.value = false
        return
      }
      const first = firstSessionWithReason(sessions, reason)
      onSelect(reason, first?.id ?? null)
      if (closeOnSelect) open.value = false
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
  }

  const renderClearButton = (closeOnSelect: boolean) => (
    <button
      type="button"
      onClick={() => {
        onSelect(null, null)
        if (closeOnSelect) open.value = false
      }}
      class="shrink-0 ml-auto text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline"
      data-testid="attention-clear"
    >
      Clear filter
    </button>
  )

  if (!isDesktop.value) {
    const triggerRing = filter !== null
      ? 'ring-2 ring-indigo-500 dark:ring-indigo-400'
      : ''
    return (
      <div
        ref={containerRef}
        class="relative px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        data-testid="attention-bar"
        role="toolbar"
        aria-label="Sessions needing attention"
      >
        <button
          type="button"
          onClick={() => { open.value = !open.value }}
          aria-haspopup="dialog"
          aria-expanded={open.value}
          data-testid="attention-toggle"
          class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 ${triggerRing}`}
        >
          <span aria-hidden>⚠️</span>
          <span>Needs attention</span>
          <span class="tabular-nums font-semibold">{total}</span>
          {filter !== null && (
            <span class="ml-1 text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
              filtered
            </span>
          )}
        </button>
        {open.value && (
          <div
            class="absolute left-3 right-3 top-full mt-1 z-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-2 flex flex-wrap items-center gap-1.5"
            data-testid="attention-popover"
          >
            {REASON_ORDER.map((reason) => renderPill(reason, true))}
            {filter !== null && renderClearButton(true)}
          </div>
        )}
      </div>
    )
  }

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
      {REASON_ORDER.map((reason) => renderPill(reason, false))}
      {filter !== null && renderClearButton(false)}
    </div>
  )
}
