import type { StatusEvent } from '../../api/types'
import { StatusIcon } from './icons'

interface Props {
  event: StatusEvent
}

const TONE: Record<StatusEvent['severity'], string> = {
  info: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300',
  warn: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200',
  error: 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
}

export function StatusBanner({ event }: Props) {
  const tone = TONE[event.severity]
  return (
    <div
      class={`flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs ${tone}`}
      data-testid="transcript-status"
      data-severity={event.severity}
    >
      <StatusIcon severity={event.severity} class="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] uppercase tracking-wider opacity-80">{event.kind}</span>
        </div>
        <div class="break-words whitespace-pre-wrap">{event.message}</div>
      </div>
    </div>
  )
}
