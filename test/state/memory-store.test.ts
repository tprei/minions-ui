import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiClient } from '../../src/api/client'
import type { MemoryEntry } from '../../src/api/types'

const mockMemories: MemoryEntry[] = [
  {
    id: 1,
    repo: 'test/repo',
    kind: 'user',
    title: 'Pending Memory',
    body: 'Pending body',
    status: 'pending',
    sourceSessionId: null,
    sourceDagId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededBy: null,
    reviewedAt: null,
    pinned: false,
  },
  {
    id: 2,
    repo: 'test/repo',
    kind: 'feedback',
    title: 'Approved Memory',
    body: 'Approved body',
    status: 'approved',
    sourceSessionId: null,
    sourceDagId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededBy: null,
    reviewedAt: Date.now(),
    pinned: false,
  },
]

function createMockClient(): ApiClient {
  return {
    getMemories: vi.fn().mockResolvedValue(mockMemories),
    reviewMemory: vi.fn().mockImplementation((id, req) => {
      const mem = mockMemories.find((m) => m.id === id)
      if (!mem) throw new Error('Not found')
      return Promise.resolve({ ...mem, status: req.status, reviewedAt: Date.now() })
    }),
    updateMemory: vi.fn().mockImplementation((id, updates) => {
      const mem = mockMemories.find((m) => m.id === id)
      if (!mem) throw new Error('Not found')
      return Promise.resolve({ ...mem, ...updates, updatedAt: Date.now() })
    }),
    deleteMemory: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ApiClient
}

describe('createMemoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setup() {
    const client = createMockClient()
    const { createMemoryStore } = await import('../../src/state/memory-store')
    const store = createMemoryStore(client)
    return { store, client }
  }

  it('initializes with empty memories', async () => {
    const { store } = await setup()
    expect(store.memories.value).toEqual([])
    expect(store.loading.value).toBe(false)
    expect(store.error.value).toBe(null)
  })

  it('fetches memories', async () => {
    const { store, client } = await setup()
    await store.fetch()
    expect(client.getMemories).toHaveBeenCalled()
    expect(store.memories.value).toEqual(mockMemories)
    expect(store.loading.value).toBe(false)
  })

  it('sets error on fetch failure', async () => {
    const { store, client } = await setup()
    ;(client.getMemories as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Fetch failed'),
    )
    await store.fetch()
    expect(store.error.value).toBe('Fetch failed')
    expect(store.loading.value).toBe(false)
  })

  it('filters by status', async () => {
    const { store, client } = await setup()
    store.setFilters({ status: 'approved' })
    expect(client.getMemories).toHaveBeenCalledWith(undefined, 'approved')
  })

  it('filters by query', async () => {
    const { store, client } = await setup()
    store.setFilters({ query: 'test' })
    expect(client.getMemories).toHaveBeenCalledWith('test', undefined)
  })

  it('approves memory', async () => {
    const { store, client } = await setup()
    store.memories.value = [...mockMemories]
    await store.approve(1)
    expect(client.reviewMemory).toHaveBeenCalledWith(1, { status: 'approved' })
    expect(store.memories.value[0].status).toBe('approved')
  })

  it('rejects memory', async () => {
    const { store, client } = await setup()
    store.memories.value = [...mockMemories]
    await store.reject(1)
    expect(client.reviewMemory).toHaveBeenCalledWith(1, { status: 'rejected' })
    expect(store.memories.value[0].status).toBe('rejected')
  })

  it('updates memory', async () => {
    const { store, client } = await setup()
    store.memories.value = [...mockMemories]
    await store.update(1, { title: 'Updated', pinned: true })
    expect(client.updateMemory).toHaveBeenCalledWith(1, { title: 'Updated', pinned: true })
    expect(store.memories.value[0].title).toBe('Updated')
    expect(store.memories.value[0].pinned).toBe(true)
  })

  it('deletes memory', async () => {
    const { store, client } = await setup()
    store.memories.value = [...mockMemories]
    await store.delete(1)
    expect(client.deleteMemory).toHaveBeenCalledWith(1)
    expect(store.memories.value.length).toBe(1)
    expect(store.memories.value.find((m) => m.id === 1)).toBeUndefined()
  })

  it('applies memory_proposed event', async () => {
    const { store } = await setup()
    const newMemory: MemoryEntry = {
      id: 3,
      repo: 'test/repo',
      kind: 'project',
      title: 'New',
      body: 'New body',
      status: 'pending',
      sourceSessionId: null,
      sourceDagId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      supersededBy: null,
      reviewedAt: null,
      pinned: false,
    }
    store.applyEvent({ type: 'memory_proposed', memory: newMemory })
    expect(store.memories.value).toContainEqual(newMemory)
  })

  it('applies memory_updated event', async () => {
    const { store } = await setup()
    store.memories.value = [...mockMemories]
    const updated = { ...mockMemories[0], title: 'Updated via event' }
    store.applyEvent({ type: 'memory_updated', memory: updated })
    expect(store.memories.value[0].title).toBe('Updated via event')
  })

  it('applies memory_reviewed event', async () => {
    const { store } = await setup()
    store.memories.value = [...mockMemories]
    const reviewed = { ...mockMemories[0], status: 'approved' as const, reviewedAt: Date.now() }
    store.applyEvent({ type: 'memory_reviewed', memory: reviewed })
    expect(store.memories.value[0].status).toBe('approved')
  })

  it('applies memory_deleted event', async () => {
    const { store } = await setup()
    store.memories.value = [...mockMemories]
    store.applyEvent({ type: 'memory_deleted', memoryId: 1 })
    expect(store.memories.value.find((m) => m.id === 1)).toBeUndefined()
  })

  it('cleans up on dispose', async () => {
    const { store } = await setup()
    store.memories.value = [...mockMemories]
    store.dispose()
    expect(store.memories.value).toEqual([])
  })
})
