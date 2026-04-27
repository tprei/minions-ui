import { get, set, del } from 'idb-keyval'
import { signal, computed } from '@preact/signals'

export interface FeedbackEntry {
  vote: 'up' | 'down'
  reason?: string
  comment?: string
  ts: number
}

type FeedbackMap = Record<string, FeedbackEntry>

interface FeedbackStore {
  v: 1
  entries: FeedbackMap
}

function key(connectionId: string): string {
  return `minions-ui:feedback:${connectionId}`
}

const cacheByConnection = signal<Map<string, FeedbackMap>>(new Map())

export function loadFeedback(connectionId: string): Promise<FeedbackMap> {
  const cached = cacheByConnection.value.get(connectionId)
  if (cached) return Promise.resolve(cached)

  return get<FeedbackStore>(key(connectionId)).then((raw) => {
    const entries = raw?.v === 1 ? raw.entries : {}
    const next = new Map(cacheByConnection.value)
    next.set(connectionId, entries)
    cacheByConnection.value = next
    return entries
  })
}

export async function recordFeedback(
  connectionId: string,
  entryKey: string,
  entry: FeedbackEntry
): Promise<void> {
  const current = cacheByConnection.value.get(connectionId) || {}
  const updated = { ...current, [entryKey]: entry }

  const next = new Map(cacheByConnection.value)
  next.set(connectionId, updated)
  cacheByConnection.value = next

  await set(key(connectionId), { v: 1, entries: updated } as FeedbackStore)
}

export async function clearFeedback(connectionId: string): Promise<void> {
  const next = new Map(cacheByConnection.value)
  next.delete(connectionId)
  cacheByConnection.value = next
  await del(key(connectionId))
}

export function useFeedbackStore(connectionId: string) {
  return computed(() => cacheByConnection.value.get(connectionId) || {})
}

export function __clearCache(): void {
  cacheByConnection.value = new Map()
}
