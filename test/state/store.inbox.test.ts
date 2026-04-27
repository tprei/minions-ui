import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient } from '../../src/api/client'
import { installMockEventSource } from '../sse-mock'
import { __resetInboxes, getInboxEvents, getUnseenCount } from '../../src/state/inbox'
import type { ApiSession, VersionInfo } from '../../src/api/types'

const BASE_URL = 'https://example.com'
const TOKEN = 'tok'

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'cool-cat',
    status: 'running',
    command: '/task hello',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

vi.mock('../../src/state/persist', () => ({
  loadSnapshot: vi.fn().mockResolvedValue(null),
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
  clearSnapshot: vi.fn().mockResolvedValue(undefined),
}))

const showLocalNotificationSpy = vi.fn()
vi.mock('../../src/pwa/local-notifications', () => ({
  showLocalNotification: (...args: unknown[]) => showLocalNotificationSpy(...args),
  isLocalNotificationsEnabled: () => false,
  isLocalNotificationsSupported: () => false,
  getLocalNotificationsPermission: () => 'unsupported',
  enableLocalNotifications: vi.fn(),
  disableLocalNotifications: vi.fn(),
  localNotificationsEnabled: () => ({ value: false }),
  requestLocalNotificationsPermission: vi.fn(),
}))

function makeResponses(sessions: ApiSession[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ data: VERSION }),
      })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ data: sessions }),
      })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ data: [] }),
      })
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ data: null, error: 'Not found' }),
    })
  })
}

describe('createConnectionStore inbox integration', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
    __resetInboxes()
    showLocalNotificationSpy.mockReset()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function seedStore(connId: string, initial: ApiSession) {
    vi.stubGlobal('fetch', makeResponses([initial]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, connId)
    await store.refresh()
    return store
  }

  it('records inbox event on session_updated status transition to completed', async () => {
    const initial = makeSession({ status: 'running' })
    const store = await seedStore('conn-inbox-1', initial)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'completed' } })

    const events = getInboxEvents('conn-inbox-1')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('completed')
    expect(events[0].sessionId).toBe('s1')
    store.dispose()
  })

  it('records inbox event on session_updated status transition to failed', async () => {
    const initial = makeSession({ status: 'running' })
    const store = await seedStore('conn-inbox-2', initial)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'failed' } })

    const events = getInboxEvents('conn-inbox-2')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('failed')
    store.dispose()
  })

  it('records inbox event when needsAttention becomes true', async () => {
    const initial = makeSession({ status: 'running', needsAttention: false })
    const store = await seedStore('conn-inbox-3', initial)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'session_updated',
      session: {
        ...initial,
        needsAttention: true,
        attentionReasons: ['waiting_for_feedback'],
      },
    })

    const events = getInboxEvents('conn-inbox-3')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('attention')
    store.dispose()
  })

  it('records inbox event when prUrl appears', async () => {
    const initial = makeSession({ status: 'completed' })
    const store = await seedStore('conn-inbox-4', initial)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'session_updated',
      session: { ...initial, prUrl: 'https://github.com/foo/bar/pull/1' },
    })

    const events = getInboxEvents('conn-inbox-4')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('landed')
    store.dispose()
  })

  it('does NOT record inbox event when status is unchanged', async () => {
    const initial = makeSession({ status: 'running' })
    const store = await seedStore('conn-inbox-5', initial)

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'session_updated',
      session: { ...initial, updatedAt: '2024-02-01' },
    })

    expect(getInboxEvents('conn-inbox-5')).toHaveLength(0)
    store.dispose()
  })

  it('does NOT record inbox event for newly created sessions (no prior state)', async () => {
    vi.stubGlobal('fetch', makeResponses([]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-inbox-6')
    await store.refresh()

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({
      type: 'session_created',
      session: makeSession({ status: 'completed' }),
    })

    expect(getInboxEvents('conn-inbox-6')).toHaveLength(0)
    store.dispose()
  })

  it('marks inbox seen for active connection on transition while document is visible', async () => {
    const initial = makeSession({ status: 'running' })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    vi.stubGlobal('fetch', makeResponses([initial]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-inbox-7', { isActive: () => true })
    await store.refresh()

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'completed' } })

    expect(getInboxEvents('conn-inbox-7')).toHaveLength(1)
    expect(getUnseenCount('conn-inbox-7')).toBe(0)
    store.dispose()
  })

  it('keeps unseen count for inactive connection', async () => {
    const originalNow = Date.now
    let now = 1_000_000
    Date.now = () => now

    const initial = makeSession({ status: 'running' })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    vi.stubGlobal('fetch', makeResponses([initial]))
    const { createConnectionStore } = await import('../../src/state/store')
    const { markInboxSeen } = await import('../../src/state/inbox')
    markInboxSeen('conn-inbox-8')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-inbox-8', { isActive: () => false })
    await store.refresh()

    now += 5000

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'completed' } })

    expect(getInboxEvents('conn-inbox-8')).toHaveLength(1)
    expect(getUnseenCount('conn-inbox-8')).toBe(1)

    Date.now = originalNow
    store.dispose()
  })

  it('fires showLocalNotification when document is hidden', async () => {
    const initial = makeSession({ status: 'running' })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    vi.stubGlobal('fetch', makeResponses([initial]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-inbox-9')
    await store.refresh()

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'completed' } })

    expect(showLocalNotificationSpy).toHaveBeenCalledTimes(1)
    expect(showLocalNotificationSpy.mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('completed'),
    })
    store.dispose()
  })

  it('does NOT fire showLocalNotification when document is visible', async () => {
    const initial = makeSession({ status: 'running' })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    vi.stubGlobal('fetch', makeResponses([initial]))
    const { createConnectionStore } = await import('../../src/state/store')
    const client = createApiClient({ baseUrl: BASE_URL, token: TOKEN })
    const store = createConnectionStore(client, 'conn-inbox-10')
    await store.refresh()

    const es = [...mock.instances.values()][0]
    es?.simulateOpen()
    es?.push({ type: 'session_updated', session: { ...initial, status: 'completed' } })

    expect(showLocalNotificationSpy).not.toHaveBeenCalled()
    store.dispose()
  })
})
