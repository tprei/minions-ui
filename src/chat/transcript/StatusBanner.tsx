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

const KIND_LABELS: Record<string, string> = {
  session_error: 'Session error',
  session_interrupted: 'Session interrupted',
  session_stalled: 'Session stalled',
  session_resumed: 'Session resumed',
  quota_exhausted: 'Quota exhausted',
  stream_stalled: 'Stream stalled',
}

function formatKind(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  return kind
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ')
}

export function StatusBanner({ event }: Props) {
  const tone = TONE[event.severity]
  return (
    <div
      class={`flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs ${tone}`}
      data-testid="transcript-status"
      data-severity={event.severity}
      data-kind={event.kind}
    >
      <StatusIcon severity={event.severity} class="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-semibold tracking-wide">{formatKind(event.kind)}</span>
        </div>
        <div class="break-words whitespace-pre-wrap">{event.message}</div>
      </div>
    </div>
  )
}
