import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TranscriptStore } from '../state/transcript'
import type {
  StatusSeverity,
  ToolCallEvent,
  ToolResultEvent,
  TranscriptEvent,
  TranscriptEventType,
  UserMessageEvent,
  AssistantTextEvent,
  ThinkingEvent,
  TurnStartedEvent,
  TurnCompletedEvent,
  StatusEvent,
} from '../api/types'
import { useTheme } from '../hooks/useTheme'

interface Props {
  sessionSlug: string
  transcript: TranscriptStore
  onClose: () => void
}

type FilterSet = ReadonlySet<TranscriptEventType>

const ALL_TYPES: TranscriptEventType[] = [
  'user_message',
  'turn_started',
  'turn_completed',
  'assistant_text',
  'thinking',
  'tool_call',
  'tool_result',
  'status',
]

const TYPE_LABEL: Record<TranscriptEventType, string> = {
  user_message: 'user',
  turn_started: 'turn·start',
  turn_completed: 'turn·end',
  assistant_text: 'assistant',
  thinking: 'thinking',
  tool_call: 'tool',
  tool_result: 'result',
  status: 'status',
}

const TYPE_TONE_LIGHT: Record<TranscriptEventType, string> = {
  user_message: 'bg-blue-100 text-blue-800',
  turn_started: 'bg-slate-100 text-slate-700',
  turn_completed: 'bg-slate-100 text-slate-700',
  assistant_text: 'bg-indigo-100 text-indigo-800',
  thinking: 'bg-violet-100 text-violet-800',
  tool_call: 'bg-amber-100 text-amber-800',
  tool_result: 'bg-emerald-100 text-emerald-800',
  status: 'bg-slate-200 text-slate-800',
}

const TYPE_TONE_DARK: Record<TranscriptEventType, string> = {
  user_message: 'bg-blue-900/60 text-blue-200',
  turn_started: 'bg-slate-700 text-slate-300',
  turn_completed: 'bg-slate-700 text-slate-300',
  assistant_text: 'bg-indigo-900/60 text-indigo-200',
  thinking: 'bg-violet-900/60 text-violet-200',
  tool_call: 'bg-amber-900/60 text-amber-200',
  tool_result: 'bg-emerald-900/60 text-emerald-200',
  status: 'bg-slate-600 text-slate-200',
}

const SEVERITY_TONE_LIGHT: Record<StatusSeverity, string> = {
  info: 'text-slate-600',
  warn: 'text-amber-700',
  error: 'text-red-700',
}

const SEVERITY_TONE_DARK: Record<StatusSeverity, string> = {
  info: 'text-slate-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
}

export function formatLogTimestamp(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}

export function summarizeLogEvent(event: TranscriptEvent): string {
  switch (event.type) {
    case 'user_message':
      return oneLine((event as UserMessageEvent).text)
    case 'turn_started':
      return `turn ${event.turn} started (${(event as TurnStartedEvent).trigger})`
    case 'turn_completed': {
      const e = event as TurnCompletedEvent
      const parts: string[] = [`turn ${event.turn} completed`]
      if (e.errored) parts.push('errored')
      if (typeof e.totalTokens === 'number') parts.push(`${e.totalTokens} tokens`)
      if (typeof e.totalCostUsd === 'number') parts.push(`$${e.totalCostUsd.toFixed(4)}`)
      if (typeof e.durationMs === 'number') parts.push(`${(e.durationMs / 1000).toFixed(1)}s`)
      return parts.join(' · ')
    }
    case 'assistant_text': {
      const e = event as AssistantTextEvent
      return `${e.final ? '' : '…'}${oneLine(e.text)}`
    }
    case 'thinking': {
      const e = event as ThinkingEvent
      return `${e.final ? '' : '…'}${oneLine(e.text)}`
    }
    case 'tool_call': {
      const e = event as ToolCallEvent
      const name = e.call.name
      const title = e.call.title ? ` — ${oneLine(e.call.title)}` : ''
      return `${name}${title}`
    }
    case 'tool_result': {
      const e = event as ToolResultEvent
      const parts: string[] = [e.result.status]
      if (e.result.error) parts.push(oneLine(e.result.error))
      else if (e.result.text) parts.push(oneLine(e.result.text))
      if (e.result.truncated) parts.push('(truncated)')
      return parts.join(' · ')
    }
    case 'status': {
      const e = event as StatusEvent
      return `[${e.severity}] ${e.kind}: ${oneLine(e.message)}`
    }
  }
}

function oneLine(text: string, max = 240): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max) + '…'
}

export function SessionLogsPopup({ sessionSlug, transcript, onClose }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const events = transcript.events.value
  const loading = transcript.loading.value
  const error = transcript.error.value
  const [filter, setFilter] = useState<FilterSet>(() => new Set(ALL_TYPES))
  const [following, setFollowing] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filtered = useMemo(
    () => events.filter((e) => filter.has(e.type)),
    [events, filter],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prev = prevCountRef.current
    prevCountRef.current = filtered.length
    if (filtered.length <= prev) return
    if (following) el.scrollTop = el.scrollHeight
  }, [filtered.length, following])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    if (nearBottom !== following) setFollowing(nearBottom)
  }

  function toggleType(type: TranscriptEventType) {
    const next = new Set(filter)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setFilter(next)
  }

  function selectAll() {
    setFilter(new Set(ALL_TYPES))
  }

  function selectNone() {
    setFilter(new Set<TranscriptEventType>())
  }

  async function copyJson() {
    const payload = JSON.stringify(filtered, null, 2)
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(payload)
      }
    } catch {
      // clipboard may be unavailable in non-secure contexts; silent no-op
    }
  }

  const overlayBg = isDark ? 'bg-black/70' : 'bg-black/50'
  const dialogBg = isDark ? 'bg-slate-900' : 'bg-white'
  const borderColor = isDark ? 'border-slate-700' : 'border-slate-200'
  const titleColor = isDark ? 'text-slate-100' : 'text-slate-900'
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500'
  const typeTone = isDark ? TYPE_TONE_DARK : TYPE_TONE_LIGHT
  const severityTone = isDark ? SEVERITY_TONE_DARK : SEVERITY_TONE_LIGHT
  const rowHover = isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'
  const pillBase = 'text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors'
  const pillOn = isDark
    ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
    : 'border-indigo-300 bg-indigo-50 text-indigo-700'
  const pillOff = isDark
    ? 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'

  const noneMatching = events.length > 0 && filtered.length === 0
  const showEmpty = events.length === 0 && !loading && !error

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="session-logs-popup"
    >
      <div class={`absolute inset-0 ${overlayBg}`} onClick={onClose} />
      <div
        class={`relative ${dialogBg} rounded-xl max-w-3xl w-full mx-4 shadow-xl overflow-hidden flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-logs-title"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
      >
        <div class={`flex items-center justify-between gap-2 px-4 py-3 border-b ${borderColor}`}>
          <div class="min-w-0 flex-1">
            <h3 id="session-logs-title" class={`text-base font-semibold ${titleColor} truncate`}>
              Logs · {sessionSlug}
            </h3>
            <div class={`text-[11px] ${mutedText} mt-0.5`} data-testid="session-logs-count">
              {filtered.length} of {events.length} event{events.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void copyJson()}
            class={`shrink-0 text-xs font-medium rounded-md border px-2.5 py-1 transition-colors ${
              isDark
                ? 'border-slate-600 text-slate-200 hover:bg-slate-700'
                : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
            data-testid="session-logs-copy"
            title="Copy filtered events as JSON"
            disabled={filtered.length === 0}
          >
            Copy JSON
          </button>
          <button
            type="button"
            onClick={onClose}
            class={`shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              isDark ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
            }`}
            aria-label="Close"
            data-testid="session-logs-close"
          >
            <span class="text-lg leading-none">&times;</span>
          </button>
        </div>

        <div class={`flex flex-wrap items-center gap-1.5 px-4 py-2 border-b ${borderColor}`}>
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              class={`${pillBase} ${filter.has(t) ? pillOn : pillOff}`}
              data-testid={`session-logs-filter-${t}`}
              aria-pressed={filter.has(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
          <div class="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={selectAll}
              class={`text-[11px] font-medium ${mutedText} hover:underline`}
              data-testid="session-logs-filter-all"
            >
              All
            </button>
            <span class={mutedText}>·</span>
            <button
              type="button"
              onClick={selectNone}
              class={`text-[11px] font-medium ${mutedText} hover:underline`}
              data-testid="session-logs-filter-none"
            >
              None
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          class={`flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-relaxed ${
            isDark ? 'bg-slate-950' : 'bg-slate-50'
          }`}
          data-testid="session-logs-body"
        >
          {error && (
            <div
              class={`px-4 py-3 text-xs ${isDark ? 'text-red-300' : 'text-red-700'}`}
              data-testid="session-logs-error"
            >
              <div class="font-semibold mb-1">Couldn’t load logs</div>
              <div class="whitespace-pre-wrap break-words">{error}</div>
              <button
                type="button"
                onClick={() => void transcript.reconcile()}
                class="mt-1.5 text-xs font-medium underline"
              >
                Retry
              </button>
            </div>
          )}
          {loading && events.length === 0 && !error && (
            <div
              class={`text-xs italic text-center py-8 ${mutedText}`}
              data-testid="session-logs-loading"
            >
              Loading logs…
            </div>
          )}
          {showEmpty && (
            <div
              class={`text-xs italic text-center py-8 ${mutedText}`}
              data-testid="session-logs-empty"
            >
              No events yet.
            </div>
          )}
          {noneMatching && (
            <div
              class={`text-xs italic text-center py-8 ${mutedText}`}
              data-testid="session-logs-no-match"
            >
              No events match the current filter.
            </div>
          )}
          {filtered.length > 0 && (
            <ul class="py-1" data-testid="session-logs-list">
              {filtered.map((e) => {
                const severityClass =
                  e.type === 'status' ? severityTone[(e as StatusEvent).severity] : ''
                return (
                  <li
                    key={e.seq}
                    class={`flex items-start gap-2 px-4 py-1 ${rowHover}`}
                    data-testid="session-logs-row"
                    data-event-type={e.type}
                    data-event-seq={e.seq}
                  >
                    <span
                      class={`shrink-0 tabular-nums ${mutedText}`}
                      data-testid="session-logs-row-timestamp"
                    >
                      {formatLogTimestamp(e.timestamp)}
                    </span>
                    <span
                      class={`shrink-0 w-14 text-[10px] tabular-nums text-right ${mutedText}`}
                      title={`turn ${e.turn}`}
                    >
                      t{e.turn}#{e.seq}
                    </span>
                    <span
                      class={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${typeTone[e.type]}`}
                    >
                      {TYPE_LABEL[e.type]}
                    </span>
                    <span
                      class={`flex-1 min-w-0 whitespace-pre-wrap break-words ${severityClass || (isDark ? 'text-slate-200' : 'text-slate-800')}`}
                      data-testid="session-logs-row-summary"
                    >
                      {summarizeLogEvent(e)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
