import type { TurnCompletedEvent, TurnStartedEvent } from '../../api/types'
import { formatCostUsd, formatDuration, formatTokens, triggerLabel } from './utils'

interface Props {
  turn: number
  started?: TurnStartedEvent
  completed?: TurnCompletedEvent
}

export function TurnSeparator({ turn, started, completed }: Props) {
  const items: string[] = []
  if (started) items.push(triggerLabel(started.trigger))
  const tokens = formatTokens(completed?.totalTokens)
  if (tokens) items.push(`${tokens} tok`)
  const cost = formatCostUsd(completed?.totalCostUsd)
  if (cost) items.push(cost)
  const duration = formatDuration(completed?.durationMs)
  if (duration) items.push(duration)

  const errored = completed?.errored === true

  return (
    <div
      class="flex items-center gap-3 my-1.5 text-[10px] uppercase tracking-wider"
      data-testid="transcript-turn-separator"
      data-turn={turn}
    >
      <div class="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      <div class={`flex items-center gap-2 ${errored ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
        <span class="font-semibold">Turn {turn}</span>
        {items.length > 0 && (
          <>
            <span class="opacity-50">·</span>
            <span class="font-mono normal-case tracking-normal">{items.join(' · ')}</span>
          </>
        )}
        {errored && (
          <span class="rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 normal-case tracking-normal font-medium">
            errored
          </span>
        )}
      </div>
      <div class="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}
