import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signal } from '@preact/signals'
import { createConnectionStore } from '../../src/state/store'
import type { ApiClient } from '../../src/api/client'
import type { ApiSession, SseEvent } from '../../src/api/types'
import type { SseStatus } from '../../src/api/sse'

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    baseUrl: 'https://api.example.com',
    token: 'test-token',
    getVersion: vi.fn().mockResolvedValue({ apiVersion: '1.0', libraryVersion: '1.0', features: [] }),
    getSessions: vi.fn().mockResolvedValue([]),
    getDags: vi.fn().mockResolvedValue([]),
    sendCommand: vi.fn(),
    sendMessage: vi.fn(),
    createSession: vi.fn(),
    createSessionVariants: vi.fn(),
    createExternalTask: vi.fn(),
    getPr: vi.fn(),
    getReadiness: vi.fn(),
    getReadinessSummary: vi.fn(),
    getAuditEvents: vi.fn(),
    listCheckpoints: vi.fn(),
    restoreCheckpoint: vi.fn(),
    getDiff: vi.fn(),
    getTranscript: vi.fn(),
    listScreenshots: vi.fn(),
    fetchScreenshotBlob: vi.fn(),
    getVapidKey: vi.fn(),
    subscribePush: vi.fn(),
    unsubscribePush: vi.fn(),
    sendTestNotification: vi.fn(),
    getMetrics: vi.fn(),
    getRuntimeConfig: vi.fn(),
    patchRuntimeConfig: vi.fn(),
    getMemories: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    reviewMemory: vi.fn(),
    deleteMemory: vi.fn(),
    openEventStream: vi.fn(() => ({
      close: vi.fn(),
      reconnect: vi.fn(),
      status: signal<SseStatus>('live'),
      reconnectAt: signal<number | null>(null),
    })),
    ...overrides,
  } as unknown as ApiClient
}

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'sess-1',
    slug: 'sess-1',
    status: 'running',
    command: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

describe('attention event tracking', () => {
  let onEventHandler: ((event: SseEvent) => void) | undefined

  beforeEach(() => {
    onEventHandler = undefined
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('tracks sessions that need attention', () => {
    const client = makeClient({
      openEventStream: vi.fn((handlers) => {
        onEventHandler = handlers.onEvent
        return {
          close: vi.fn(),
          reconnect: vi.fn(),
          status: signal<SseStatus>('live'),
          reconnectAt: signal<number | null>(null),
        }
      }),
    })

    const store = createConnectionStore(client, 'conn-1')
    expect(store.attentionSessionIds.value.size).toBe(0)

    const session = makeSession({ id: 'sess-attention', needsAttention: true, attentionReasons: ['failed'] })
    onEventHandler?.({ type: 'session_updated', session })

    expect(store.attentionSessionIds.value.has('sess-attention')).toBe(true)
    expect(store.attentionSessionIds.value.size).toBe(1)
  })

  it('removes sessions from attention set when no longer needing attention', () => {
    const client = makeClient({
      openEventStream: vi.fn((handlers) => {
        onEventHandler = handlers.onEvent
        return {
          close: vi.fn(),
          reconnect: vi.fn(),
          status: signal<SseStatus>('live'),
          reconnectAt: signal<number | null>(null),
        }
      }),
    })

    const store = createConnectionStore(client, 'conn-1')

    const sessionNeedsAttention = makeSession({
      id: 'sess-1',
      needsAttention: true,
      attentionReasons: ['waiting_for_feedback'],
    })
    onEventHandler?.({ type: 'session_updated', session: sessionNeedsAttention })
    expect(store.attentionSessionIds.value.has('sess-1')).toBe(true)

    const sessionNoAttention = makeSession({ id: 'sess-1', needsAttention: false, attentionReasons: [] })
    onEventHandler?.({ type: 'session_updated', session: sessionNoAttention })
    expect(store.attentionSessionIds.value.has('sess-1')).toBe(false)
  })

  it('tracks multiple sessions needing attention simultaneously', () => {
    const client = makeClient({
      openEventStream: vi.fn((handlers) => {
        onEventHandler = handlers.onEvent
        return {
          close: vi.fn(),
          reconnect: vi.fn(),
          status: signal<SseStatus>('live'),
          reconnectAt: signal<number | null>(null),
        }
      }),
    })

    const store = createConnectionStore(client, 'conn-1')

    onEventHandler?.({
      type: 'session_updated',
      session: makeSession({ id: 'sess-1', needsAttention: true, attentionReasons: ['failed'] }),
    })
    onEventHandler?.({
      type: 'session_updated',
      session: makeSession({ id: 'sess-2', needsAttention: true, attentionReasons: ['ci_fix'] }),
    })
    onEventHandler?.({
      type: 'session_updated',
      session: makeSession({ id: 'sess-3', needsAttention: false }),
    })

    expect(store.attentionSessionIds.value.size).toBe(2)
    expect(store.attentionSessionIds.value.has('sess-1')).toBe(true)
    expect(store.attentionSessionIds.value.has('sess-2')).toBe(true)
    expect(store.attentionSessionIds.value.has('sess-3')).toBe(false)
  })

  it('handles session_created events with attention flag', () => {
    const client = makeClient({
      openEventStream: vi.fn((handlers) => {
        onEventHandler = handlers.onEvent
        return {
          close: vi.fn(),
          reconnect: vi.fn(),
          status: signal<SseStatus>('live'),
          reconnectAt: signal<number | null>(null),
        }
      }),
    })

    const store = createConnectionStore(client, 'conn-1')

    const session = makeSession({ id: 'sess-new', needsAttention: true, attentionReasons: ['interrupted'] })
    onEventHandler?.({ type: 'session_created', session })

    expect(store.sessions.value).toContainEqual(expect.objectContaining({ id: 'sess-new' }))
  })
})
