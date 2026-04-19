import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTranscriptStore } from '../../src/state/transcript'
import type { ApiClient } from '../../src/api/client'
import type {
  TranscriptEvent,
  TranscriptSnapshot,
  UserMessageEvent,
  AssistantTextEvent,
} from '../../src/api/types'

function userMsg(seq: number, text = 't'): UserMessageEvent {
  return {
    seq,
    id: `e${seq}`,
    sessionId: 's1',
    turn: 1,
    timestamp: 1_700_000_000 + seq,
    type: 'user_message',
    text,
  }
}

function assistantMsg(seq: number, text = 'hi'): AssistantTextEvent {
  return {
    seq,
    id: `e${seq}`,
    sessionId: 's1',
    turn: 1,
    timestamp: 1_700_000_000 + seq,
    type: 'assistant_text',
    blockId: `b${seq}`,
    text,
    final: true,
  }
}

function snapshot(events: TranscriptEvent[], highWaterMark?: number): TranscriptSnapshot {
  return {
    session: { sessionId: 's1', startedAt: 1_700_000_000, active: true },
    events,
    highWaterMark: highWaterMark ?? (events.length ? events[events.length - 1].seq : 0),
  }
}

function makeClient(getTranscript: (slug: string, afterSeq?: number) => Promise<TranscriptSnapshot>): ApiClient {
  return { getTranscript } as unknown as ApiClient
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('createTranscriptStore', () => {
  let capturedCalls: Array<{ slug: string; afterSeq?: number }>

  beforeEach(() => {
    capturedCalls = []
  })

  it('fetches initial snapshot and populates signals', async () => {
    const events = [userMsg(1, 'hello'), assistantMsg(2, 'world')]
    const client = makeClient((slug, afterSeq) => {
      capturedCalls.push({ slug, afterSeq })
      return Promise.resolve(snapshot(events))
    })

    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    expect(store.loading.value).toBe(true)
    await flush()

    expect(capturedCalls).toEqual([{ slug: 'brave-lion', afterSeq: undefined }])
    expect(store.events.value).toEqual(events)
    expect(store.highWaterMark.value).toBe(2)
    expect(store.loading.value).toBe(false)
    expect(store.error.value).toBeNull()
    expect(store.session.value?.sessionId).toBe('s1')
  })

  it('records error when fetch fails', async () => {
    const client = makeClient(() => Promise.reject(new Error('boom')))
    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()

    expect(store.error.value).toBe('boom')
    expect(store.loading.value).toBe(false)
    expect(store.events.value).toEqual([])
  })

  it('appends live SSE events that extend the high-water mark', async () => {
    const client = makeClient(() => Promise.resolve(snapshot([userMsg(1), assistantMsg(2)])))
    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()

    store.applyEvent(assistantMsg(3, 'more'))

    expect(store.events.value.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(store.highWaterMark.value).toBe(3)
  })

  it('deduplicates SSE events already at/below the high-water mark', async () => {
    const client = makeClient(() => Promise.resolve(snapshot([userMsg(1), assistantMsg(2)])))
    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()

    store.applyEvent(assistantMsg(2, 'dup'))

    expect(store.events.value).toHaveLength(2)
    expect(store.highWaterMark.value).toBe(2)
  })

  it('reconciles via refetch when an SSE gap is detected', async () => {
    const first = snapshot([userMsg(1), assistantMsg(2)], 2)
    const healing = snapshot([assistantMsg(3, 'filled'), userMsg(4, 'caught up')], 5)

    const client = makeClient((slug, afterSeq) => {
      capturedCalls.push({ slug, afterSeq })
      if (afterSeq === undefined) return Promise.resolve(first)
      return Promise.resolve(healing)
    })

    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()
    expect(store.highWaterMark.value).toBe(2)

    store.applyEvent(assistantMsg(5, 'future'))
    await flush()

    expect(capturedCalls.length).toBeGreaterThanOrEqual(2)
    expect(capturedCalls[1].afterSeq).toBe(2)
    expect(store.events.value.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(store.highWaterMark.value).toBe(5)
  })

  it('reconcile() heals gaps with afterSeq=highWaterMark after reconnect', async () => {
    const first = snapshot([userMsg(1), assistantMsg(2)], 2)
    const healing = snapshot([assistantMsg(3), userMsg(4)], 4)

    let resolveSecond: (v: TranscriptSnapshot) => void = () => {}
    const client = makeClient((slug, afterSeq) => {
      capturedCalls.push({ slug, afterSeq })
      if (afterSeq === undefined) return Promise.resolve(first)
      return new Promise<TranscriptSnapshot>((r) => {
        resolveSecond = r
      })
    })

    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()

    const healPromise = store.reconcile()
    expect(capturedCalls[1]).toEqual({ slug: 'brave-lion', afterSeq: 2 })

    resolveSecond(healing)
    await healPromise

    expect(store.events.value.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(store.highWaterMark.value).toBe(4)
  })

  it('coalesces concurrent reconciles while a fetch is in flight', async () => {
    let resolveFirst: (v: TranscriptSnapshot) => void = () => {}
    const fetcher = vi
      .fn<(slug: string, afterSeq?: number) => Promise<TranscriptSnapshot>>()
      .mockImplementationOnce(
        () =>
          new Promise<TranscriptSnapshot>((r) => {
            resolveFirst = r
          }),
      )
      .mockImplementation(() => Promise.resolve(snapshot([userMsg(1)])))
    const client = makeClient(fetcher)

    const store = createTranscriptStore({ client, slug: 'brave-lion' })

    void store.reconcile()
    void store.reconcile()
    void store.reconcile()

    resolveFirst(snapshot([userMsg(1)]))
    await flush()

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('dispose() stops further mutations from fetch results', async () => {
    let resolver: (v: TranscriptSnapshot) => void = () => {}
    const client = makeClient(
      () =>
        new Promise<TranscriptSnapshot>((r) => {
          resolver = r
        }),
    )

    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    store.dispose()
    resolver(snapshot([userMsg(1)]))
    await flush()

    expect(store.events.value).toEqual([])
    expect(store.loading.value).toBe(true)
  })

  it('dispose() ignores subsequent applyEvent calls', async () => {
    const client = makeClient(() => Promise.resolve(snapshot([userMsg(1)])))
    const store = createTranscriptStore({ client, slug: 'brave-lion' })
    await flush()

    store.dispose()
    store.applyEvent(assistantMsg(2))
    expect(store.events.value).toEqual([userMsg(1)])
  })
})
