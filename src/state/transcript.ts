import { signal } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import type { ApiClient } from '../api/client'
import type { TranscriptEvent, TranscriptSessionInfo } from '../api/types'

export interface TranscriptStore {
  events: ReadonlySignal<TranscriptEvent[]>
  session: ReadonlySignal<TranscriptSessionInfo | null>
  highWaterMark: ReadonlySignal<number>
  loading: ReadonlySignal<boolean>
  error: ReadonlySignal<string | null>
  reconcile(): Promise<void>
  applyEvent(event: TranscriptEvent): void
  dispose(): void
}

export interface CreateTranscriptStoreOpts {
  client: ApiClient
  slug: string
}

export function createTranscriptStore(opts: CreateTranscriptStoreOpts): TranscriptStore {
  const { client, slug } = opts
  const events = signal<TranscriptEvent[]>([])
  const session = signal<TranscriptSessionInfo | null>(null)
  const highWaterMark = signal<number>(0)
  const loading = signal<boolean>(false)
  const error = signal<string | null>(null)

  let disposed = false
  let inFlight: Promise<void> | null = null
  let pendingReconcile = false

  async function fetchTranscript(afterSeq: number | undefined): Promise<void> {
    if (disposed) return
    loading.value = true
    error.value = null
    try {
      const snap = await client.getTranscript(slug, afterSeq)
      if (disposed) return
      session.value = snap.session
      events.value = mergeBySeq(events.value, snap.events)
      if (snap.highWaterMark > highWaterMark.value) {
        highWaterMark.value = snap.highWaterMark
      }
    } catch (e) {
      if (disposed) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (!disposed) loading.value = false
    }
  }

  function reconcile(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (inFlight) {
      pendingReconcile = true
      return inFlight
    }
    const afterSeq = highWaterMark.value > 0 ? highWaterMark.value : undefined
    const run = fetchTranscript(afterSeq).finally(() => {
      inFlight = null
      if (!disposed && pendingReconcile) {
        pendingReconcile = false
        void reconcile()
      }
    })
    inFlight = run
    return run
  }

  function applyEvent(event: TranscriptEvent): void {
    if (disposed) return
    if (event.seq <= highWaterMark.value) {
      if (events.value.some((e) => e.seq === event.seq)) return
      events.value = mergeBySeq(events.value, [event])
      return
    }
    if (highWaterMark.value > 0 && event.seq > highWaterMark.value + 1) {
      void reconcile()
      return
    }
    events.value = [...events.value, event]
    highWaterMark.value = event.seq
  }

  void reconcile()

  return {
    events,
    session,
    highWaterMark,
    loading,
    error,
    reconcile,
    applyEvent,
    dispose() {
      disposed = true
    },
  }
}

function mergeBySeq(existing: TranscriptEvent[], incoming: TranscriptEvent[]): TranscriptEvent[] {
  if (incoming.length === 0) return existing
  const bySeq = new Map<number, TranscriptEvent>()
  for (const e of existing) bySeq.set(e.seq, e)
  for (const e of incoming) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
