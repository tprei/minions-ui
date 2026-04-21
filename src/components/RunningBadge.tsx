import type { ConnectionStore } from '../state/types'
import { countRunning, firstRunningId } from '../state/running'

interface Props {
  store: ConnectionStore
  onSelect?: (sessionId: string) => void
}

export function RunningBadge({ store, onSelect }: Props) {
  const sessions = store.sessions.value
  const n = countRunning(sessions)
  if (n === 0) return null

  const handleClick = () => {
    if (!onSelect) return
    const id = firstRunningId(sessions)
    if (id) onSelect(id)
  }

  const interactive = typeof onSelect === 'function'
  const base =
    'rounded-full h-7 px-2.5 flex items-center gap-1.5 text-[10px] font-semibold tabular-nums border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
  const hover = interactive ? 'hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer' : 'cursor-default'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!interactive}
      class={`${base} ${hover}`}
      data-testid="running-badge"
      data-running-count={n}
      title={interactive ? `${n} session${n === 1 ? '' : 's'} running — click to jump` : `${n} session${n === 1 ? '' : 's'} running`}
      aria-label={`${n} ${n === 1 ? 'session is' : 'sessions are'} running`}
    >
      <span class="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      <span>{n}</span>
      <span class="hidden sm:inline">running</span>
    </button>
  )
}
