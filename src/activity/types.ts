import type { ApiSession, ApiDagGraph } from '../api/types'

export type ActivityEventType =
  | 'session_created'
  | 'session_updated'
  | 'session_deleted'
  | 'session_status_changed'
  | 'dag_created'
  | 'dag_updated'
  | 'dag_deleted'
  | 'attention_raised'
  | 'error_occurred'
  | 'message_sent'

export interface ActivityEvent {
  id: string
  connectionId: string
  connectionLabel: string
  connectionColor: string
  type: ActivityEventType
  timestamp: number
  sessionId?: string
  sessionSlug?: string
  dagId?: string
  message?: string
  error?: string
  status?: string
  oldStatus?: string
  session?: ApiSession
  dag?: ApiDagGraph
}

export interface ActivityFilters {
  connectionIds: Set<string>
  types: Set<ActivityEventType>
  searchQuery: string
}
