import { signal, computed } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import type { VariantGroup, VariantGroupsState } from './types'

const STORAGE_KEY = 'minions-ui:variant-groups:v1'

function migrate(raw: unknown): VariantGroupsState {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    (raw as Record<string, unknown>).version === 1 &&
    typeof (raw as Record<string, unknown>).byConnection === 'object'
  ) {
    return raw as VariantGroupsState
  }
  return { version: 1, byConnection: {} }
}

function load(): VariantGroupsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { version: 1, byConnection: {} }
    return migrate(JSON.parse(stored) as unknown)
  } catch {
    return { version: 1, byConnection: {} }
  }
}

function persist(state: VariantGroupsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage quota, private mode — skip silently
  }
}

const state = signal<VariantGroupsState>(load())

export const variantGroupsState: ReadonlySignal<VariantGroupsState> = state

export function groupsForConnection(connectionId: string): VariantGroup[] {
  return state.value.byConnection[connectionId] ?? []
}

export function variantGroupsSignal(connectionId: string): ReadonlySignal<VariantGroup[]> {
  return computed(() => state.value.byConnection[connectionId] ?? [])
}

export function getVariantGroup(connectionId: string, groupId: string): VariantGroup | null {
  const list = groupsForConnection(connectionId)
  return list.find((g) => g.groupId === groupId) ?? null
}

export function recordVariantGroup(connectionId: string, group: VariantGroup): void {
  const current = state.value
  const existing = current.byConnection[connectionId] ?? []
  const idx = existing.findIndex((g) => g.groupId === group.groupId)
  const next = idx === -1 ? [...existing, group] : existing.map((g) => (g.groupId === group.groupId ? group : g))
  const nextState: VariantGroupsState = {
    version: 1,
    byConnection: { ...current.byConnection, [connectionId]: next },
  }
  state.value = nextState
  persist(nextState)
}

export function setVariantWinner(connectionId: string, groupId: string, winnerId: string): void {
  const current = state.value
  const existing = current.byConnection[connectionId] ?? []
  const idx = existing.findIndex((g) => g.groupId === groupId)
  if (idx === -1) return
  const group = existing[idx]
  if (!group.variantSessionIds.includes(winnerId)) return
  const updated: VariantGroup = { ...group, winnerId }
  const next = existing.map((g) => (g.groupId === groupId ? updated : g))
  const nextState: VariantGroupsState = {
    version: 1,
    byConnection: { ...current.byConnection, [connectionId]: next },
  }
  state.value = nextState
  persist(nextState)
}

export function removeVariantGroup(connectionId: string, groupId: string): void {
  const current = state.value
  const existing = current.byConnection[connectionId] ?? []
  const next = existing.filter((g) => g.groupId !== groupId)
  if (next.length === existing.length) return
  const nextState: VariantGroupsState = {
    version: 1,
    byConnection: { ...current.byConnection, [connectionId]: next },
  }
  state.value = nextState
  persist(nextState)
}

export function clearConnectionGroups(connectionId: string): void {
  const current = state.value
  if (!(connectionId in current.byConnection)) return
  const rest: Record<string, VariantGroup[]> = {}
  for (const [cid, list] of Object.entries(current.byConnection)) {
    if (cid !== connectionId) rest[cid] = list
  }
  const nextState: VariantGroupsState = { version: 1, byConnection: rest }
  state.value = nextState
  persist(nextState)
}

export function resetVariantGroupsForTests(): void {
  state.value = { version: 1, byConnection: {} }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}
