import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TranscriptStore } from '../../state/transcript'
import { AssistantTextBlock } from './AssistantTextBlock'
import { StatusBanner } from './StatusBanner'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'
import { ToolResultOrphan } from './ToolResultOrphan'
import { ChevronIcon } from './icons'
import { TurnSeparator } from './TurnSeparator'
import { UserMessageCard } from './UserMessageCard'
import { buildTranscriptRows, type TranscriptRow } from './utils'

const NEAR_BOTTOM_PX = 120
const TOOL_GROUP_COLLAPSE_THRESHOLD = 5

interface Props {
  store: TranscriptStore
}

export function Transcript({ store }: Props) {
  const events = store.events.value
  const loading = store.loading.value
  const error = store.error.value
  const rows = useMemo(() => buildTranscriptRows(events).rows, [events])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const prevCountRef = useRef(rows.length)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prev = prevCountRef.current
    prevCountRef.current = rows.length
    if (rows.length <= prev) return
    if (following) el.scrollTop = el.scrollHeight
  }, [rows.length, following])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX
    if (nearBottom !== following) setFollowing(nearBottom)
  }

  function jumpToLatest() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
  }

  const showEmpty = rows.length === 0 && !loading && !error

  return (
    <div class="relative flex-1 flex min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        class="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 bg-slate-50 dark:bg-slate-900"
        data-testid="transcript"
      >
        {error && (
          <div
            class="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            data-testid="transcript-error"
          >
            <div class="font-medium mb-0.5">Couldn’t load transcript</div>
            <div class="font-mono whitespace-pre-wrap break-words">{error}</div>
            <button
              type="button"
              onClick={() => void store.reconcile()}
              class="mt-1.5 text-xs font-medium underline"
            >
              Retry
            </button>
          </div>
        )}
        {loading && rows.length === 0 && !error && (
          <div
            class="text-xs text-slate-500 dark:text-slate-400 italic text-center py-8"
            data-testid="transcript-loading"
          >
            Loading transcript…
          </div>
        )}
        {showEmpty && (
          <div class="text-xs text-slate-500 dark:text-slate-400 italic text-center py-8">
            No transcript activity yet.
          </div>
        )}
        {groupRows(rows).map((item) =>
          item.kind === 'tool-group' ? (
            <ToolGroup key={`tg:${item.items[0].call.call.toolUseId}`} items={item.items} />
          ) : (
            <RowView key={rowKey(item.row)} row={item.row} />
          ),
        )}
      </div>
      {!following && rows.length > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          data-testid="transcript-jump-to-latest"
          aria-label="Jump to latest events"
          class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-md hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-5 5a.75.75 0 0 1-1.06 0l-5-5a.75.75 0 1 1 1.06-1.06l3.72 3.72V3.75A.75.75 0 0 1 10 3Z" clip-rule="evenodd" />
          </svg>
          Jump to latest
        </button>
      )}
    </div>
  )
}

function RowView({ row }: { row: TranscriptRow }) {
  switch (row.kind) {
    case 'turn-separator':
      return <TurnSeparator turn={row.turn} started={row.started} completed={row.completed} />
    case 'user-message':
      return <UserMessageCard event={row.event} />
    case 'assistant-text':
      return <AssistantTextBlock event={row.event} />
    case 'thinking':
      return <ThinkingBlock event={row.event} />
    case 'tool-call':
      return <ToolCallCard call={row.call} result={row.result} />
    case 'tool-result-orphan':
      return <ToolResultOrphan event={row.event} />

    case 'status':
      return <StatusBanner event={row.event} />
  }
}

type ToolCallRow = Extract<TranscriptRow, { kind: 'tool-call' }>
type RenderItem =
  | { kind: 'single'; row: TranscriptRow }
  | { kind: 'tool-group'; items: ToolCallRow[] }

function groupRows(rows: TranscriptRow[]): RenderItem[] {
  const out: RenderItem[] = []
  let buf: ToolCallRow[] = []
  function flush() {
    if (buf.length === 0) return
    if (buf.length === 1) out.push({ kind: 'single', row: buf[0] })
    else out.push({ kind: 'tool-group', items: buf })
    buf = []
  }
  for (const row of rows) {
    if (row.kind === 'tool-call') {
      buf.push(row)
      continue
    }
    flush()
    out.push({ kind: 'single', row })
  }
  flush()
  return out
}

function ToolGroup({ items }: { items: ToolCallRow[] }) {
  const [open, setOpen] = useState(items.length <= TOOL_GROUP_COLLAPSE_THRESHOLD)

  let pending = 0
  let errors = 0
  for (const row of items) {
    const status = row.result?.result.status ?? 'pending'
    if (status === 'pending') pending++
    else if (status === 'error') errors++
  }

  const label = `${items.length} tool ${items.length === 1 ? 'call' : 'calls'}`

  return (
    <div
      class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
      data-testid="transcript-tool-group"
      data-open={open}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40"
        aria-expanded={open}
        data-testid="transcript-tool-group-toggle"
      >
        <ChevronIcon open={open} class="w-3 h-3 text-slate-400 shrink-0" />
        <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {pending > 0 && (
          <span
            class="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            data-testid="transcript-tool-group-pending"
          >
            {pending} pending
          </span>
        )}
        {errors > 0 && (
          <span
            class="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
            data-testid="transcript-tool-group-errors"
          >
            {errors} {errors === 1 ? 'error' : 'errors'}
          </span>
        )}
      </button>
      {open && (
        <div class="border-t border-slate-200 dark:border-slate-700">
          {items.map((row) => (
            <ToolCallCard
              key={row.call.call.toolUseId}
              call={row.call}
              result={row.result}
              variant="grouped"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function rowKey(row: TranscriptRow): string {
  switch (row.kind) {
    case 'turn-separator': return `t:${row.turn}`
    case 'user-message': return `um:${row.event.id}`
    case 'assistant-text': return `at:${row.blockId}`
    case 'thinking': return `th:${row.blockId}`
    case 'tool-call': return `tc:${row.call.call.toolUseId}`
    case 'tool-result-orphan': return `tro:${row.event.id}`
    case 'status': return `st:${row.event.id}`
  }
}
