import type { ActivityCounts } from './types'

interface ConnectionIndicatorsProps {
  unreadCount?: number
  activityCounts?: ActivityCounts
  compact?: boolean
}

export function ConnectionIndicators({ unreadCount, activityCounts, compact = false }: ConnectionIndicatorsProps) {
  const hasUnread = unreadCount !== undefined && unreadCount > 0
  const hasActivity = activityCounts && (activityCounts.running > 0 || activityCounts.pending > 0 || activityCounts.waiting > 0)

  if (!hasUnread && !hasActivity) return null

  if (compact) {
    return (
      <div class="flex items-center gap-1 shrink-0">
        {hasUnread && (
          <span
            class="flex items-center justify-center min-w-[1rem] h-4 px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white"
            data-testid="connection-unread-badge"
          >
            {unreadCount}
          </span>
        )}
        {hasActivity && (
          <span
            class="h-2 w-2 rounded-full bg-blue-500"
            data-testid="connection-activity-dot"
            title={formatActivityTitle(activityCounts)}
          />
        )}
      </div>
    )
  }

  return (
    <div class="flex items-center gap-1.5 shrink-0 text-xs">
      {hasUnread && (
        <span
          class="flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 font-semibold rounded-full bg-red-500 text-white"
          data-testid="connection-unread-badge"
          title={`${unreadCount} session${unreadCount === 1 ? '' : 's'} need${unreadCount === 1 ? 's' : ''} attention`}
        >
          {unreadCount}
        </span>
      )}
      {activityCounts && (
        <div class="flex items-center gap-1" data-testid="connection-activity-badges">
          {activityCounts.running > 0 && (
            <span
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500 text-white font-medium"
              title={`${activityCounts.running} running`}
            >
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {activityCounts.running}
            </span>
          )}
          {activityCounts.waiting > 0 && (
            <span
              class="px-1.5 py-0.5 rounded-full bg-amber-500 text-white font-medium"
              title={`${activityCounts.waiting} waiting`}
            >
              {activityCounts.waiting}
            </span>
          )}
          {activityCounts.pending > 0 && (
            <span
              class="px-1.5 py-0.5 rounded-full bg-slate-400 dark:bg-slate-600 text-white font-medium"
              title={`${activityCounts.pending} pending`}
            >
              {activityCounts.pending}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function formatActivityTitle(counts?: ActivityCounts): string {
  if (!counts) return ''
  const parts: string[] = []
  if (counts.running > 0) parts.push(`${counts.running} running`)
  if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`)
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  return parts.join(', ')
}
