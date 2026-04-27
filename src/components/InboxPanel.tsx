import { useComputed } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { inboxSignal, type InboxEvent, type InboxEventKind } from '../state/inbox'

interface InboxListProps {
  connectionId: string
  onSelect?: (event: InboxEvent) => void
}

interface InboxPanelProps extends InboxListProps {
  onClose: () => void
}

const KIND_LABELS: Record<InboxEventKind, string> = {
  completed: 'completed',
  failed: 'failed',
  attention: 'needs attention',
  landed: 'PR opened',
}

const KIND_COLORS: Record<InboxEventKind, string> = {
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  attention: 'bg-amber-500',
  landed: 'bg-indigo-500',
}

function formatRelative(now: number, ts: number): string {
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

export function InboxList({ connectionId, onSelect }: InboxListProps) {
  const inbox = useComputed(() => inboxSignal(connectionId).value)
  const now = Date.now()
  const events = inbox.value.events
  const lastSeenAt = inbox.value.lastSeenAt

  if (events.length === 0) {
    return (
      <div
        class="px-3 py-6 text-xs text-slate-500 dark:text-slate-400 text-center"
        data-testid="inbox-empty"
      >
        Nothing new since your last visit.
      </div>
    )
  }

  return (
    <ul class="max-h-[60dvh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
      {events.map((event) => {
        const unseen = event.ts > lastSeenAt
        return (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onSelect?.(event)}
              data-testid={`inbox-item-${event.id}`}
              data-unseen={unseen ? 'true' : 'false'}
              class={`w-full flex items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-700 ${unseen ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}
            >
              <span
                class={`mt-1 h-2 w-2 rounded-full shrink-0 ${KIND_COLORS[event.kind]}`}
                aria-hidden="true"
              />
              <span class="flex-1 min-w-0">
                <span class="block font-mono text-slate-900 dark:text-slate-100 truncate">
                  {event.sessionSlug}
                </span>
                <span class="block text-slate-500 dark:text-slate-400">
                  {KIND_LABELS[event.kind]} · {formatRelative(now, event.ts)}
                </span>
              </span>
              {unseen && (
                <span
                  class="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0"
                  aria-label="unseen"
                  data-testid="inbox-item-unseen-dot"
                />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function InboxPanel({ connectionId, onClose, onSelect }: InboxPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  return (
    <div
      ref={containerRef}
      class="absolute right-0 top-full mt-1 z-50 min-w-[280px] max-w-[360px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden"
      data-testid="inbox-panel"
      role="dialog"
      aria-label="Activity since last visit"
    >
      <div class="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Recent activity
        </span>
        <button
          type="button"
          onClick={onClose}
          class="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1 rounded"
          data-testid="inbox-panel-close"
          aria-label="Close inbox"
        >
          Close
        </button>
      </div>
      <InboxList
        connectionId={connectionId}
        onSelect={(event) => {
          onSelect?.(event)
          onClose()
        }}
      />
    </div>
  )
}

export function InboxSheet({ connectionId, onClose, onSelect }: InboxPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div class="fixed inset-x-0 top-0 z-50 h-[100dvh]" data-testid="inbox-sheet">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="inbox-sheet-backdrop"
      />
      <div class="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 max-h-[75dvh]">
        <div class="flex justify-center pt-2 pb-1 shrink-0">
          <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>
        <div class="px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent activity</h3>
          <button
            type="button"
            onClick={onClose}
            class="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1 rounded min-h-[44px]"
            data-testid="inbox-sheet-close"
            aria-label="Close inbox"
          >
            Close
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <InboxList
            connectionId={connectionId}
            onSelect={(event) => {
              onSelect?.(event)
              onClose()
            }}
          />
        </div>
      </div>
    </div>
  )
}
