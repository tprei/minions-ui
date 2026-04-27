import { useEffect } from 'preact/hooks'
import type { TranscriptStore } from '../state/transcript'
import { useTheme } from '../hooks/useTheme'
import { TimelineLog } from './TimelineLog'

export { formatLogTimestamp, summarizeLogEvent } from './TimelineLog'

interface Props {
  sessionSlug: string
  transcript: TranscriptStore
  onClose: () => void
}

export function SessionLogsPopup({ sessionSlug, transcript, onClose }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const overlayBg = isDark ? 'bg-black/70' : 'bg-black/50'
  const dialogBg = isDark ? 'bg-slate-900' : 'bg-white'
  const borderColor = isDark ? 'border-slate-700' : 'border-slate-200'
  const titleColor = isDark ? 'text-slate-100' : 'text-slate-900'

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
          </div>
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
        <TimelineLog transcript={transcript} testIdPrefix="session-logs" />
      </div>
    </div>
  )
}
