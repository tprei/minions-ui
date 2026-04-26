import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startPushNotifier } from './notifier'
import type { EngineEventBus } from '../events/bus'
import type { ApiSession } from '../../shared/api-types'

vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    setVapidDetails: vi.fn(),
  },
}))

vi.mock('./vapid-keys', () => ({
  ensureVapidKeys: vi.fn(() => ({
    subject: 'mailto:test@example.com',
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
  })),
}))

vi.mock('./subscriptions', () => ({
  list: vi.fn(() => []),
  removeById: vi.fn(),
}))

function createMockBus(): EngineEventBus {
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  return {
    onKind: vi.fn((kind: string, handler: (event: unknown) => void) => {
      if (!handlers.has(kind)) handlers.set(kind, [])
      handlers.get(kind)?.push(handler)
      return () => {}
    }),
    emit: vi.fn((event: unknown) => {
      const kind = (event as { kind: string }).kind
      handlers.get(kind)?.forEach((h) => h(event))
    }),
  } as unknown as EngineEventBus
}

function createMockSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'sess-1',
    slug: 'test-session',
    status: 'running',
    command: 'test',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:01:00Z',
    childIds: [],
    needsAttention: true,
    attentionReasons: [],
    quickActions: [],
    mode: 'test',
    conversation: [],
    ...overrides,
  }
}

describe('startPushNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['PWA_ORIGIN'] = 'https://app.example.com'
    process.env['API_BASE_URL'] = 'https://api.example.com'
    process.env['MINION_API_TOKEN'] = 'test-token'
  })

  it('includes approve/reject actions for waiting_for_feedback reason', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    ])

    const bus = createMockBus()
    startPushNotifier(bus, 'https://app.example.com', 'https://api.example.com')

    bus.emit({
      kind: 'session.snapshot',
      session: createMockSession({
        attentionReasons: ['waiting_for_feedback'],
      }),
    })

    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"actions":[{"action":"approve","title":"Approve"},{"action":"reject","title":"Reject"}]'),
      expect.anything(),
    )
  })

  it('includes continue action for interrupted reason', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    ])

    const bus = createMockBus()
    startPushNotifier(bus, 'https://app.example.com', 'https://api.example.com')

    bus.emit({
      kind: 'session.snapshot',
      session: createMockSession({
        id: 'sess-3',
        slug: 'waiting-session',
        attentionReasons: ['interrupted'],
      }),
    })

    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"actions":[{"action":"continue","title":"Continue"}]'),
      expect.anything(),
    )
  })

  it('includes no actions for other reasons', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    ])

    const bus = createMockBus()
    startPushNotifier(bus, 'https://app.example.com', 'https://api.example.com')

    bus.emit({
      kind: 'session.snapshot',
      session: createMockSession({
        id: 'sess-5',
        slug: 'other-session',
        status: 'failed',
        attentionReasons: ['failed'],
      }),
    })

    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"actions":[]'),
      expect.anything(),
    )
  })

  it('includes baseUrl and token in notification data', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    ])

    const bus = createMockBus()
    startPushNotifier(bus, 'https://app.example.com', 'https://api.example.com')

    bus.emit({
      kind: 'session.snapshot',
      session: createMockSession({
        id: 'sess-6',
        slug: 'auth-session',
        attentionReasons: ['waiting_for_feedback'],
      }),
    })

    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"baseUrl":"https://api.example.com"'),
      expect.anything(),
    )
    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"token":"test-token"'),
      expect.anything(),
    )
  })

  it('does not send notification when session does not need attention', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    ])

    const bus = createMockBus()
    startPushNotifier(bus, 'https://app.example.com', 'https://api.example.com')

    bus.emit({
      kind: 'session.snapshot',
      session: createMockSession({
        id: 'sess-7',
        slug: 'no-attention',
        needsAttention: false,
        attentionReasons: [],
      }),
    })

    expect(webpush.default.sendNotification).not.toHaveBeenCalled()
  })
})
