export interface Connection {
  id: string
  label: string
  baseUrl: string
  token: string
  color: string
}

export interface ConnectionsState {
  version: 1
  connections: Connection[]
  activeId: string | null
}
