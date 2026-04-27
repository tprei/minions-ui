import { signal, computed, type ReadonlySignal } from '@preact/signals'

export type InboxEventKind = 'completed' | 'failed' | 'attention' | 'landed'

export interface InboxEvent {
  id: string
  sessionId: string
  sessionSlug: string
  label: string
  kind: InboxEventKind
  ts: number
}

interface InboxState {
  events: InboxEvent[]
  lastSeenAt: number
}

const MAX_EVENTS = 50
const STORAGE_KEY = 'minions-ui:inbox:v1'

interface PersistedInbox {
  version: 1
  perConnection: Record<string, { lastSeenAt: number }>
}

function loadPersisted(): PersistedInbox {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, perConnection: {} }
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as PersistedInbox).version === 1 &&
      typeof (parsed as PersistedInbox).perConnection === 'object'
    ) {
      return parsed as PersistedInbox
    }
  } catch {
    // fall through
  }
  return { version: 1, perConnection: {} }
}

function savePersisted(state: PersistedInbox): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or disabled — degrade silently
  }
}

const inboxes = signal<Map<string, InboxState>>(new Map())

function getOrInitState(connectionId: string): InboxState {
  const existing = inboxes.value.get(connectionId)
  if (existing) return existing
  const persisted = loadPersisted()
  const lastSeenAt = persisted.perConnection[connectionId]?.lastSeenAt ?? 0
  const fresh: InboxState = { events: [], lastSeenAt }
  const next = new Map(inboxes.value)
  next.set(connectionId, fresh)
  inboxes.value = next
  return fresh
}

export function recordInboxEvent(connectionId: string, event: InboxEvent): void {
  const current = getOrInitState(connectionId)
  const dedupedEvents = current.events.filter((e) => e.id !== event.id)
  const events = [event, ...dedupedEvents].slice(0, MAX_EVENTS)
  const next = new Map(inboxes.value)
  next.set(connectionId, { ...current, events })
  inboxes.value = next
}

export function markInboxSeen(connectionId: string): void {
  const current = getOrInitState(connectionId)
  const lastSeenAt = Date.now()
  const next = new Map(inboxes.value)
  next.set(connectionId, { ...current, lastSeenAt })
  inboxes.value = next

  const persisted = loadPersisted()
  persisted.perConnection[connectionId] = { lastSeenAt }
  savePersisted(persisted)
}

export function clearInbox(connectionId: string): void {
  const next = new Map(inboxes.value)
  next.delete(connectionId)
  inboxes.value = next
  const persisted = loadPersisted()
  delete persisted.perConnection[connectionId]
  savePersisted(persisted)
}

export function getInboxEvents(connectionId: string): InboxEvent[] {
  return inboxes.value.get(connectionId)?.events ?? []
}

export function getUnseenCount(connectionId: string): number {
  const state = inboxes.value.get(connectionId)
  if (!state) return 0
  return state.events.filter((e) => e.ts > state.lastSeenAt).length
}

export function inboxSignal(connectionId: string): ReadonlySignal<{
  events: InboxEvent[]
  unseenCount: number
  lastSeenAt: number
}> {
  return computed(() => {
    const state = inboxes.value.get(connectionId)
    if (!state) return { events: [], unseenCount: 0, lastSeenAt: 0 }
    const unseenCount = state.events.filter((e) => e.ts > state.lastSeenAt).length
    return { events: state.events, unseenCount, lastSeenAt: state.lastSeenAt }
  })
}

export function __resetInboxes(): void {
  inboxes.value = new Map()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
