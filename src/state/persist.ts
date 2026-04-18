import { get, set, del } from 'idb-keyval'
import type { ApiDagGraph, ApiSession, VersionInfo } from '../api/types'

interface Snapshot {
  v: 1
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  version: VersionInfo
  savedAt: string
}

function key(connectionId: string): string {
  return `minions-ui:snapshot:${connectionId}`
}

export async function loadSnapshot(connectionId: string): Promise<Snapshot | null> {
  const raw = await get<Snapshot>(key(connectionId))
  if (!raw || raw.v !== 1) return null
  return raw
}

export async function saveSnapshot(connectionId: string, snapshot: Omit<Snapshot, 'v' | 'savedAt'>): Promise<void> {
  await set(key(connectionId), { v: 1, ...snapshot, savedAt: new Date().toISOString() })
}

export async function clearSnapshot(connectionId: string): Promise<void> {
  await del(key(connectionId))
}
