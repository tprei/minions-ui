import { signal, type Signal } from '@preact/signals'
import type { ApiClient } from '../api/client'
import type { MemoryEntry, MemoryStatus, SseEvent } from '../api/types'

export interface MemoryFilters {
  status?: MemoryStatus | 'all'
  query?: string
}

export interface MemoryStore {
  memories: Signal<MemoryEntry[]>
  loading: Signal<boolean>
  error: Signal<string | null>
  filters: Signal<MemoryFilters>
  fetch(): Promise<void>
  setFilters(filters: MemoryFilters): void
  approve(id: number): Promise<void>
  reject(id: number): Promise<void>
  update(id: number, updates: { title?: string; body?: string; pinned?: boolean }): Promise<void>
  delete(id: number): Promise<void>
  applyEvent(event: SseEvent): void
  dispose(): void
}

export function createMemoryStore(client: ApiClient): MemoryStore {
  const memories = signal<MemoryEntry[]>([])
  const loading = signal<boolean>(false)
  const error = signal<string | null>(null)
  const filters = signal<MemoryFilters>({})

  let fetchInFlight = false

  async function fetch() {
    if (fetchInFlight) return
    fetchInFlight = true
    loading.value = true
    error.value = null
    try {
      const statusParam =
        filters.value.status && filters.value.status !== 'all' ? filters.value.status : undefined
      const result = await client.getMemories(filters.value.query, statusParam)
      if (!Array.isArray(result)) {
        throw new Error('Invalid response: expected array of memories')
      }
      memories.value = result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      memories.value = []
    } finally {
      loading.value = false
      fetchInFlight = false
    }
  }

  function setFilters(newFilters: MemoryFilters) {
    filters.value = newFilters
    void fetch()
  }

  async function approve(id: number) {
    try {
      const updated = await client.reviewMemory(id, { status: 'approved' })
      const idx = memories.value.findIndex((m) => m.id === id)
      if (idx !== -1) {
        const next = [...memories.value]
        next[idx] = updated
        memories.value = next
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function reject(id: number) {
    try {
      const updated = await client.reviewMemory(id, { status: 'rejected' })
      const idx = memories.value.findIndex((m) => m.id === id)
      if (idx !== -1) {
        const next = [...memories.value]
        next[idx] = updated
        memories.value = next
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function update(
    id: number,
    updates: { title?: string; body?: string; pinned?: boolean },
  ) {
    try {
      const updated = await client.updateMemory(id, updates)
      const idx = memories.value.findIndex((m) => m.id === id)
      if (idx !== -1) {
        const next = [...memories.value]
        next[idx] = updated
        memories.value = next
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function deleteMemory(id: number) {
    try {
      await client.deleteMemory(id)
      memories.value = memories.value.filter((m) => m.id !== id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function applyEvent(event: SseEvent) {
    switch (event.type) {
      case 'memory_proposed': {
        const existing = memories.value.find((m) => m.id === event.memory.id)
        if (!existing) {
          memories.value = [event.memory, ...memories.value]
        }
        break
      }
      case 'memory_updated': {
        const idx = memories.value.findIndex((m) => m.id === event.memory.id)
        if (idx !== -1) {
          const next = [...memories.value]
          next[idx] = event.memory
          memories.value = next
        } else {
          memories.value = [event.memory, ...memories.value]
        }
        break
      }
      case 'memory_reviewed': {
        const idx = memories.value.findIndex((m) => m.id === event.memory.id)
        if (idx !== -1) {
          const next = [...memories.value]
          next[idx] = event.memory
          memories.value = next
        }
        break
      }
      case 'memory_deleted': {
        memories.value = memories.value.filter((m) => m.id !== event.memoryId)
        break
      }
    }
  }

  return {
    memories,
    loading,
    error,
    filters,
    fetch,
    setFilters,
    approve,
    reject,
    update,
    delete: deleteMemory,
    applyEvent,
    dispose() {
      memories.value = []
    },
  }
}
