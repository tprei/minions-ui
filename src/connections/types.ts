export interface ActivityCounts {
  running: number
  pending: number
  waiting: number
}

export interface Connection {
  id: string
  label: string
  baseUrl: string
  token: string
  color: string
  unreadCount?: number
  activityCounts?: ActivityCounts
}

export interface ConnectionsState {
  version: 1
  connections: Connection[]
  activeId: string | null
}
