import { useState } from 'preact/hooks'
import type { ToolResultEvent } from '../../api/types'
import { ChevronIcon } from './icons'
import { ToolResultBody } from './ToolResultBody'

const RESULT_BIG_BYTES = 1024

interface Props {
  event: ToolResultEvent
}

export function ToolResultOrphan({ event }: Props) {
  const [open, setOpen] = useState(() => !isBig(event))

  return (
    <div
      class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
      data-testid="transcript-tool-result-orphan"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/60"
        aria-expanded={open}
        data-testid="transcript-tool-result-orphan-toggle"
      >
        <ChevronIcon open={open} class="w-3 h-3 text-slate-500 dark:text-slate-300 shrink-0" />
        <span class="text-[11px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
          Tool result (no matching call)
        </span>
        <span class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
          {summarize(event)}
        </span>
        <span class="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && <ToolResultBody event={event} />}
    </div>
  )
}

function isBig(event: ToolResultEvent): boolean {
  const { result } = event
  if (result.truncated) return true
  if (result.originalBytes !== undefined && result.originalBytes > RESULT_BIG_BYTES) return true
  if (result.text && result.text.length > RESULT_BIG_BYTES) return true
  return false
}

function summarize(event: ToolResultEvent): string {
  const { result } = event
  if (result.originalBytes !== undefined) {
    return result.originalBytes < 1024
      ? `${result.originalBytes} B`
      : `${(result.originalBytes / 1024).toFixed(1)} KB`
  }
  if (result.text) {
    const bytes = result.text.length
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  }
  if (result.images && result.images.length > 0) {
    return result.images.length === 1 ? '1 image' : `${result.images.length} images`
  }
  return ''
}
