import { useState } from 'preact/hooks'
import type { ThinkingEvent } from '../../api/types'
import { ChevronIcon, BrainIcon } from './icons'

interface Props {
  event: ThinkingEvent
  defaultOpen?: boolean
}

export function ThinkingBlock({ event, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const preview = event.text.slice(0, 80).replace(/\s+/g, ' ').trim()
  const shouldTruncate = event.text.length > 80
  return (
    <div
      class="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40"
      data-testid="transcript-thinking"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-md"
        aria-expanded={open}
        data-testid="transcript-thinking-toggle"
      >
        <ChevronIcon open={open} class="w-3 h-3 text-slate-400" />
        <BrainIcon class="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
        <span class="font-medium">Thinking</span>
        {!event.final && (
          <span
            class="inline-block h-2 w-2 rounded-full bg-purple-500 animate-pulse"
            aria-label="Streaming"
          />
        )}
        {!open && shouldTruncate && (
          <span class="ml-2 truncate text-slate-400 dark:text-slate-500 italic">
            {preview}…
          </span>
        )}
        {!open && !shouldTruncate && event.text && (
          <span class="ml-2 truncate text-slate-400 dark:text-slate-500 italic">{preview}</span>
        )}
      </button>
      {open && (
        <div
          class="px-3 pb-3 pt-1 text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300 font-mono"
          data-testid="transcript-thinking-body"
        >
          {event.text || <span class="italic text-slate-400">empty thinking block</span>}
        </div>
      )}
    </div>
  )
}
