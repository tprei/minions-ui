import { useSignal, useComputed } from '@preact/signals'
import { useRef, useCallback } from 'preact/hooks'
import { connections, activeId } from '../connections/store'
import { inboxSignal, type InboxEvent } from '../state/inbox'
import { InboxPanel } from './InboxPanel'

interface InboxButtonProps {
  onSelectEvent?: (connectionId: string, event: InboxEvent) => void
}

export function InboxButton({ onSelectEvent }: InboxButtonProps) {
  const open = useSignal(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const totalUnseen = useComputed(() => {
    let total = 0
    for (const conn of connections.value) {
      total += inboxSignal(conn.id).value.unseenCount
    }
    return total
  })

  const handleSelect = useCallback(
    (event: InboxEvent) => {
      const id = activeId.value
      if (id) onSelectEvent?.(id, event)
    },
    [onSelectEvent],
  )

  const id = activeId.value
  const totalEvents = useComputed(() => (id ? inboxSignal(id).value.events.length : 0))

  return (
    <div class="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => { open.value = !open.value }}
        disabled={!id}
        aria-haspopup="dialog"
        aria-expanded={open.value}
        class="relative rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        title={totalEvents.value === 0 ? 'No recent activity' : 'Recent activity since last visit'}
        aria-label="Open inbox"
        data-testid="header-inbox-btn"
      >
        <span aria-hidden="true">📥</span>
        {totalUnseen.value > 0 && (
          <span
            class="absolute -top-1 -right-1 rounded-full bg-indigo-600 text-white text-[10px] font-medium px-1 min-w-[16px] h-4 flex items-center justify-center"
            data-testid="inbox-total-unseen-badge"
            aria-label={`${totalUnseen.value} unseen`}
          >
            {totalUnseen.value}
          </span>
        )}
      </button>
      {open.value && id && (
        <InboxPanel
          connectionId={id}
          onClose={() => { open.value = false }}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}
