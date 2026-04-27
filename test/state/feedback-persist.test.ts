import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('idb-keyval', () => ({
  get: vi.fn((k: string) => Promise.resolve(store.get(k))),
  set: vi.fn((k: string, v: unknown) => { store.set(k, v); return Promise.resolve() }),
  del: vi.fn((k: string) => { store.delete(k); return Promise.resolve() }),
}))

import { loadFeedback, recordFeedback, clearFeedback, useFeedbackStore, __clearCache } from '../../src/state/feedback-persist'
import type { FeedbackEntry } from '../../src/state/feedback-persist'

describe('feedback-persist', () => {
  beforeEach(() => {
    store.clear()
    __clearCache()
  })

  it('loadFeedback returns empty object when no entry exists', async () => {
    const entries = await loadFeedback('conn-1')
    expect(entries).toEqual({})
  })

  it('recordFeedback stores entry and updates cache', async () => {
    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)

    const entries = await loadFeedback('conn-1')
    expect(entries['s1:block1']).toEqual(entry)
  })

  it('recordFeedback merges with existing entries', async () => {
    const entry1: FeedbackEntry = { vote: 'up', ts: Date.now() }
    const entry2: FeedbackEntry = { vote: 'down', reason: 'Incorrect', ts: Date.now() + 1 }

    await recordFeedback('conn-1', 's1:block1', entry1)
    await recordFeedback('conn-1', 's1:block2', entry2)

    const entries = await loadFeedback('conn-1')
    expect(entries['s1:block1']).toEqual(entry1)
    expect(entries['s1:block2']).toEqual(entry2)
  })

  it('recordFeedback overwrites existing entry with same key', async () => {
    const entry1: FeedbackEntry = { vote: 'up', ts: Date.now() }
    const entry2: FeedbackEntry = { vote: 'down', reason: 'Incorrect', ts: Date.now() + 1 }

    await recordFeedback('conn-1', 's1:block1', entry1)
    await recordFeedback('conn-1', 's1:block1', entry2)

    const entries = await loadFeedback('conn-1')
    expect(entries['s1:block1']).toEqual(entry2)
  })

  it('clearFeedback removes all entries', async () => {
    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)
    await clearFeedback('conn-1')

    const entries = await loadFeedback('conn-1')
    expect(entries).toEqual({})
  })

  it('isolates feedback across connections', async () => {
    const entry1: FeedbackEntry = { vote: 'up', ts: Date.now() }
    const entry2: FeedbackEntry = { vote: 'down', reason: 'Wrong', ts: Date.now() }

    await recordFeedback('conn-1', 's1:block1', entry1)
    await recordFeedback('conn-2', 's1:block1', entry2)

    const entries1 = await loadFeedback('conn-1')
    const entries2 = await loadFeedback('conn-2')

    expect(entries1['s1:block1']).toEqual(entry1)
    expect(entries2['s1:block1']).toEqual(entry2)
  })

  it('loadFeedback returns from cache on subsequent calls', async () => {
    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)

    const entries1 = await loadFeedback('conn-1')
    const entries2 = await loadFeedback('conn-1')

    expect(entries1).toBe(entries2)
  })

  it('useFeedbackStore returns computed signal with entries', async () => {
    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)

    const store = useFeedbackStore('conn-1')
    expect(store.value['s1:block1']).toEqual(entry)
  })

  it('useFeedbackStore returns empty object for unknown connection', () => {
    const store = useFeedbackStore('unknown')
    expect(store.value).toEqual({})
  })

  it('useFeedbackStore reactively updates when recordFeedback is called', async () => {
    await loadFeedback('conn-1')

    const store = useFeedbackStore('conn-1')
    expect(store.value).toEqual({})

    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)

    expect(store.value['s1:block1']).toEqual(entry)
  })

  it('stores feedback with reason and comment', async () => {
    const entry: FeedbackEntry = {
      vote: 'down',
      reason: 'Incorrect',
      comment: 'The response was factually wrong',
      ts: Date.now(),
    }
    await recordFeedback('conn-1', 's1:block1', entry)

    const entries = await loadFeedback('conn-1')
    expect(entries['s1:block1']).toEqual(entry)
  })

  it('persists to IDB with correct structure', async () => {
    const entry: FeedbackEntry = { vote: 'up', ts: Date.now() }
    await recordFeedback('conn-1', 's1:block1', entry)

    const raw = store.get('minions-ui:feedback:conn-1')
    expect(raw).toEqual({
      v: 1,
      entries: {
        's1:block1': entry,
      },
    })
  })
})
