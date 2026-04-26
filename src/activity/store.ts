import { signal, computed } from '@preact/signals'
import type { SseEvent } from '../api/types'
import type { Connection } from '../connections/types'
import type { ActivityEvent, ActivityFilters } from './types'

const MAX_EVENTS = 500

const events = signal<ActivityEvent[]>([])
const filters = signal<ActivityFilters>({
  connectionIds: new Set(),
  types: new Set(),
  searchQuery: '',
})

const sessionStatusCache = new Map<string, string>()

export function trackEvent(
  connectionId: string,
  connection: Connection,
  event: SseEvent,
): void {
  const baseEvent = {
    id: crypto.randomUUID(),
    connectionId,
    connectionLabel: connection.label,
    connectionColor: connection.color,
    timestamp: Date.now(),
  }

  let activityEvent: ActivityEvent | null = null

  switch (event.type) {
    case 'session_created':
      activityEvent = {
        ...baseEvent,
        type: 'session_created',
        sessionId: event.session.id,
        sessionSlug: event.session.slug,
        session: event.session,
        message: `Session ${event.session.slug} created`,
      }
      sessionStatusCache.set(`${connectionId}:${event.session.id}`, event.session.status)
      break

    case 'session_updated': {
      const cacheKey = `${connectionId}:${event.session.id}`
      const oldStatus = sessionStatusCache.get(cacheKey)
      const newStatus = event.session.status

      if (oldStatus && oldStatus !== newStatus) {
        activityEvent = {
          ...baseEvent,
          type: 'session_status_changed',
          sessionId: event.session.id,
          sessionSlug: event.session.slug,
          session: event.session,
          oldStatus,
          status: newStatus,
          message: `Session ${event.session.slug} ${newStatus}`,
        }
      } else if (event.session.needsAttention && event.session.attentionReasons.length > 0) {
        activityEvent = {
          ...baseEvent,
          type: 'attention_raised',
          sessionId: event.session.id,
          sessionSlug: event.session.slug,
          session: event.session,
          message: `Session ${event.session.slug} needs attention: ${event.session.attentionReasons.join(', ')}`,
        }
      } else {
        activityEvent = {
          ...baseEvent,
          type: 'session_updated',
          sessionId: event.session.id,
          sessionSlug: event.session.slug,
          session: event.session,
          message: `Session ${event.session.slug} updated`,
        }
      }

      sessionStatusCache.set(cacheKey, newStatus)
      break
    }

    case 'session_deleted':
      activityEvent = {
        ...baseEvent,
        type: 'session_deleted',
        sessionId: event.sessionId,
        message: `Session deleted`,
      }
      sessionStatusCache.delete(`${connectionId}:${event.sessionId}`)
      break

    case 'dag_created':
      activityEvent = {
        ...baseEvent,
        type: 'dag_created',
        dagId: event.dag.id,
        dag: event.dag,
        message: `DAG ${event.dag.id.slice(0, 8)} created`,
      }
      break

    case 'dag_updated':
      activityEvent = {
        ...baseEvent,
        type: 'dag_updated',
        dagId: event.dag.id,
        dag: event.dag,
        message: `DAG ${event.dag.id.slice(0, 8)} updated`,
      }
      break

    case 'dag_deleted':
      activityEvent = {
        ...baseEvent,
        type: 'dag_deleted',
        dagId: event.dagId,
        message: `DAG ${event.dagId.slice(0, 8)} deleted`,
      }
      break

    case 'transcript_event':
      if (event.event.type === 'user_message' || event.event.type === 'assistant_text') {
        activityEvent = {
          ...baseEvent,
          type: 'message_sent',
          sessionId: event.sessionId,
          message: `Message in session`,
        }
      }
      break

    default:
      return
  }

  if (!activityEvent) return

  const current = events.value
  const updated = [activityEvent, ...current].slice(0, MAX_EVENTS)
  events.value = updated
}

export const filteredEvents = computed(() => {
  const f = filters.value
  let result = events.value

  if (f.connectionIds.size > 0) {
    result = result.filter((e) => f.connectionIds.has(e.connectionId))
  }

  if (f.types.size > 0) {
    result = result.filter((e) => f.types.has(e.type))
  }

  if (f.searchQuery.trim()) {
    const query = f.searchQuery.toLowerCase()
    result = result.filter(
      (e) =>
        e.message?.toLowerCase().includes(query) ||
        e.sessionSlug?.toLowerCase().includes(query) ||
        e.connectionLabel.toLowerCase().includes(query)
    )
  }

  return result
})

export function setFilters(patch: Partial<ActivityFilters>): void {
  filters.value = { ...filters.value, ...patch }
}

export function clearFilters(): void {
  filters.value = {
    connectionIds: new Set(),
    types: new Set(),
    searchQuery: '',
  }
}

export function clearEvents(): void {
  events.value = []
  sessionStatusCache.clear()
}

export const activityFilters = filters
export const activityEvents = events
