import { useState } from 'preact/hooks'
import type { ToolCallEvent, ToolResultEvent } from '../../api/types'
import { ChevronIcon, ToolKindIcon } from './icons'
import { ToolResultBody } from './ToolResultBody'

interface Props {
  call: ToolCallEvent
  result: ToolResultEvent | null
  defaultOpen?: boolean
}

export function ToolCallCard({ call, result, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const summary = call.call

  const status: 'pending' | 'ok' | 'error' = result?.result.status ?? 'pending'
  const statusBadge = (
    <span
      class={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${
        status === 'ok'
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
          : status === 'error'
            ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 animate-pulse'
      }`}
      data-testid={`transcript-tool-status-${status}`}
    >
      {status}
    </span>
  )

  return (
    <div
      class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden"
      data-testid="transcript-tool-call"
      data-tool-kind={summary.kind}
      data-tool-status={status}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40"
        aria-expanded={open}
        data-testid="transcript-tool-call-toggle"
      >
        <ChevronIcon open={open} class="w-3 h-3 text-slate-400" />
        <ToolKindIcon kind={summary.kind} class="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        <span class="font-mono text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
          {summary.name}
        </span>
        <span class="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
          {summary.title}
        </span>
        {summary.subtitle && (
          <span class="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
            {summary.subtitle}
          </span>
        )}
        <span class="ml-auto flex items-center gap-2">{statusBadge}</span>
      </button>
      {open && (
        <div
          class="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
          data-testid="transcript-tool-call-body"
        >
          <ToolInputView input={summary.input} />
          {result ? (
            <div class="border-t border-slate-200 dark:border-slate-700">
              <div class="px-3 py-1 text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                Result
              </div>
              <ToolResultBody event={result} />
            </div>
          ) : (
            <div
              class="border-t border-slate-200 dark:border-slate-700 px-3 py-2 text-[11px] italic text-slate-500 dark:text-slate-400"
              data-testid="transcript-tool-call-pending"
            >
              Waiting for result…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolInputView({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input)
  if (entries.length === 0) return null
  return (
    <div class="px-3 py-2" data-testid="transcript-tool-input">
      <div class="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1">
        Input
      </div>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
        {entries.map(([k, v]) => (
          <RowItem key={k} k={k} v={v} />
        ))}
      </dl>
    </div>
  )
}

function RowItem({ k, v }: { k: string; v: unknown }) {
  const formatted = formatValue(v)
  return (
    <>
      <dt class="font-mono text-slate-500 dark:text-slate-400">{k}</dt>
      <dd class="font-mono text-slate-700 dark:text-slate-300 break-all whitespace-pre-wrap">
        {formatted}
      </dd>
    </>
  )
}

function formatValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
