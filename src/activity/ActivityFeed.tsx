import { useState } from 'preact/hooks'
import { filteredEvents, setFilters, clearFilters, clearEvents, activityFilters } from './store'
import { connections } from '../connections/store'
import type { ActivityEventType } from './types'
import { formatDistanceToNow } from './time-utils'

const eventTypeLabels: Record<ActivityEventType, string> = {
  session_created: 'Session Created',
  session_updated: 'Session Updated',
  session_deleted: 'Session Deleted',
  session_status_changed: 'Status Changed',
  dag_created: 'DAG Created',
  dag_updated: 'DAG Updated',
  dag_deleted: 'DAG Deleted',
  attention_raised: 'Attention Needed',
  error_occurred: 'Error',
  message_sent: 'Message',
}

const eventTypeIcons: Record<ActivityEventType, string> = {
  session_created: '✨',
  session_updated: '🔄',
  session_deleted: '🗑️',
  session_status_changed: '📊',
  dag_created: '🌳',
  dag_updated: '🔄',
  dag_deleted: '🗑️',
  attention_raised: '⚠️',
  error_occurred: '❌',
  message_sent: '💬',
}

function EventIcon({ type }: { type: ActivityEventType }) {
  return (
    <span
      class="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 text-sm shrink-0"
      aria-hidden="true"
    >
      {eventTypeIcons[type]}
    </span>
  )
}

function ConnectionBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-white shrink-0"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  )
}

function FilterPanel({
  onClose,
}: {
  onClose: () => void
}) {
  const filters = activityFilters.value
  const conns = connections.value

  const handleConnectionToggle = (id: string) => {
    const next = new Set(filters.connectionIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setFilters({ connectionIds: next })
  }

  const handleTypeToggle = (type: ActivityEventType) => {
    const next = new Set(filters.types)
    if (next.has(type)) {
      next.delete(type)
    } else {
      next.add(type)
    }
    setFilters({ types: next })
  }

  const handleClear = () => {
    clearFilters()
  }

  const allTypes: ActivityEventType[] = Object.keys(eventTypeLabels) as ActivityEventType[]

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        class="w-full max-w-md bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            class="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>
        <div class="p-4 max-h-[60vh] overflow-y-auto">
          <div class="space-y-4">
            <div>
              <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Connections</h3>
              <div class="space-y-1">
                {conns.map((conn) => (
                  <label key={conn.id} class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.connectionIds.has(conn.id)}
                      onChange={() => handleConnectionToggle(conn.id)}
                      class="rounded"
                    />
                    <ConnectionBadge label={conn.label} color={conn.color} />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Event Types</h3>
              <div class="space-y-1">
                {allTypes.map((type) => (
                  <label key={type} class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.types.has(type)}
                      onChange={() => handleTypeToggle(type)}
                      class="rounded"
                    />
                    <span class="text-sm text-slate-700 dark:text-slate-200">
                      {eventTypeIcons[type]} {eventTypeLabels[type]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <button
            type="button"
            onClick={handleClear}
            class="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            class="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export function ActivityFeed() {
  const [showFilters, setShowFilters] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const events = filteredEvents.value
  const filters = activityFilters.value

  const handleSearch = (value: string) => {
    setSearchQuery(value)
    setFilters({ searchQuery: value })
  }

  const handleClearAll = async () => {
    if (typeof window === 'undefined') return
    if (!window.confirm('Clear all activity events? This cannot be undone.')) return
    clearEvents()
  }

  const activeFilterCount = filters.connectionIds.size + filters.types.size

  return (
    <div class="flex flex-col h-full bg-white dark:bg-slate-800">
      <header class="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <h1 class="text-lg font-semibold text-slate-900 dark:text-slate-100">Activity Feed</h1>
        <span class="text-xs text-slate-500 dark:text-slate-400">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            class="relative rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="activity-filter-btn"
          >
            Filters
            {activeFilterCount > 0 && (
              <span class="absolute -top-1 -right-1 rounded-full bg-indigo-600 text-white text-[10px] font-medium px-1 min-w-[16px] h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleClearAll()}
            class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="activity-clear-btn"
          >
            Clear
          </button>
        </div>
      </header>
      <div class="px-4 py-2 border-b border-slate-200 dark:border-slate-700">
        <input
          type="search"
          placeholder="Search events..."
          value={searchQuery}
          onInput={(e) => handleSearch((e.target as HTMLInputElement).value)}
          class="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          data-testid="activity-search"
        />
      </div>
      <div class="flex-1 overflow-y-auto" data-testid="activity-timeline">
        {events.length === 0 ? (
          <div class="flex items-center justify-center h-full px-4 py-8">
            <div class="text-center">
              <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">No activity yet</p>
              <p class="text-xs text-slate-400 dark:text-slate-500">
                Events from all connections will appear here
              </p>
            </div>
          </div>
        ) : (
          <div class="divide-y divide-slate-200 dark:divide-slate-700">
            {events.map((event) => (
              <div
                key={event.id}
                class="flex gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
                data-testid="activity-event"
              >
                <EventIcon type={event.type} />
                <div class="flex-1 min-w-0">
                  <div class="flex items-start gap-2 mb-1">
                    <ConnectionBadge
                      label={event.connectionLabel}
                      color={event.connectionColor}
                    />
                    <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDistanceToNow(event.timestamp)}
                    </span>
                  </div>
                  <p class="text-sm text-slate-700 dark:text-slate-200 mb-1">
                    {event.message}
                  </p>
                  {event.sessionSlug && (
                    <a
                      href={`#/s/${encodeURIComponent(event.sessionSlug)}`}
                      class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono"
                    >
                      {event.sessionSlug}
                    </a>
                  )}
                  {event.status && (
                    <div class="flex items-center gap-1.5 mt-1">
                      {event.oldStatus && (
                        <>
                          <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {event.oldStatus}
                          </span>
                          <span class="text-slate-400 dark:text-slate-500" aria-hidden="true">
                            →
                          </span>
                        </>
                      )}
                      <span
                        class={`text-xs font-medium ${
                          event.status === 'completed'
                            ? 'text-green-700 dark:text-green-300'
                            : event.status === 'failed'
                              ? 'text-red-700 dark:text-red-300'
                              : event.status === 'running'
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {event.status}
                      </span>
                    </div>
                  )}
                  {event.error && (
                    <div class="mt-1 text-xs text-red-600 dark:text-red-400 font-mono">
                      {event.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showFilters && <FilterPanel onClose={() => setShowFilters(false)} />}
    </div>
  )
}
