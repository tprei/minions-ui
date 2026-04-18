import { signal } from '@preact/signals'
import { createApiClient } from '../api/client'
import { createConnectionStore } from '../state/store'
import { clearSnapshot } from '../state/persist'
import type { ConnectionStore } from '../state/types'
import type { Connection, ConnectionsState } from './types'
import { nextColor } from '../theme/colors'

const STORAGE_KEY = 'minions-ui:connections:v1'

function migrate(raw: unknown): ConnectionsState {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    (raw as Record<string, unknown>).version === 1 &&
    Array.isArray((raw as Record<string, unknown>).connections)
  ) {
    return raw as ConnectionsState
  }
  return { version: 1, connections: [], activeId: null }
}

function load(): ConnectionsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { version: 1, connections: [], activeId: null }
    return migrate(JSON.parse(stored) as unknown)
  } catch {
    return { version: 1, connections: [], activeId: null }
  }
}

function persist(state: ConnectionsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

const initial = load()

export const connections = signal<Connection[]>(initial.connections)
export const activeId = signal<string | null>(initial.activeId)

const storeCache = new Map<string, ConnectionStore>()

function getOrCreateStore(id: string): ConnectionStore {
  const existing = storeCache.get(id)
  if (existing) return existing
  const conn = connections.value.find((c) => c.id === id)
  if (!conn) throw new Error(`Connection ${id} not found`)
  const client = createApiClient({ baseUrl: conn.baseUrl, token: conn.token })
  const store = createConnectionStore(client, id)
  storeCache.set(id, store)
  return store
}

function saveState() {
  persist({ version: 1, connections: connections.value, activeId: activeId.value })
}

export function addConnection(c: Omit<Connection, 'id' | 'color'> & { color?: string }): Connection {
  const color = c.color ?? nextColor(connections.value.map((x) => x.color))
  const conn: Connection = { ...c, id: crypto.randomUUID(), color }
  connections.value = [...connections.value, conn]
  saveState()
  return conn
}

export function updateConnection(id: string, patch: Partial<Omit<Connection, 'id'>>): void {
  connections.value = connections.value.map((c) => (c.id === id ? { ...c, ...patch } : c))
  saveState()
}

export function removeConnection(id: string): void {
  const store = storeCache.get(id)
  if (store) {
    store.dispose()
    storeCache.delete(id)
  }
  connections.value = connections.value.filter((c) => c.id !== id)
  if (activeId.value === id) activeId.value = null
  saveState()
  void clearSnapshot(id)
}

export function setActive(id: string | null): void {
  const prev = activeId.value
  if (prev && prev !== id) {
    const prevStore = storeCache.get(prev)
    if (prevStore) {
      prevStore.dispose()
      storeCache.delete(prev)
    }
  }
  activeId.value = id
  if (id) getOrCreateStore(id)
  saveState()
}

export function getActiveStore(): ConnectionStore | null {
  const id = activeId.value
  if (!id) return null
  return getOrCreateStore(id)
}

export function disposeAll(): void {
  for (const store of storeCache.values()) {
    store.dispose()
  }
  storeCache.clear()
}
