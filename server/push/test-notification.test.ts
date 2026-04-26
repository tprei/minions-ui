import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendTestNotification } from './test-notification'

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

describe('sendTestNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when no subscriptions exist', async () => {
    const { list } = await import('./subscriptions')
    vi.mocked(list).mockReturnValue([])
    await expect(sendTestNotification('https://app.example.com')).rejects.toThrow('No push subscriptions found')
  })

  it('sends test notification to all subscriptions', async () => {
    const { list } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/sub1',
        expirationTime: null,
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
      {
        id: 'sub-2',
        endpoint: 'https://push.example.com/sub2',
        expirationTime: null,
        keys: { p256dh: 'key2', auth: 'auth2' },
      },
    ])

    await sendTestNotification('https://app.example.com')

    expect(webpush.default.setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'test-public-key',
      'test-private-key',
    )
    expect(webpush.default.sendNotification).toHaveBeenCalledTimes(2)
    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example.com/sub1' }),
      expect.stringContaining('Test notification'),
      expect.objectContaining({ urgency: 'normal' }),
    )
  })

  it('removes stale subscription on 404 error', async () => {
    const { list, removeById } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-stale',
        endpoint: 'https://push.example.com/stale',
        expirationTime: null,
        keys: { p256dh: 'key', auth: 'auth' },
      },
    ])
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode: 404 })

    await sendTestNotification('https://app.example.com')

    expect(removeById).toHaveBeenCalledWith('sub-stale')
  })

  it('removes stale subscription on 410 error', async () => {
    const { list, removeById } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-gone',
        endpoint: 'https://push.example.com/gone',
        expirationTime: null,
        keys: { p256dh: 'key', auth: 'auth' },
      },
    ])
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode: 410 })

    await sendTestNotification('https://app.example.com')

    expect(removeById).toHaveBeenCalledWith('sub-gone')
  })

  it('does not remove subscription on other errors', async () => {
    const { list, removeById } = await import('./subscriptions')
    const webpush = await import('web-push')
    vi.mocked(list).mockReturnValue([
      {
        id: 'sub-ok',
        endpoint: 'https://push.example.com/ok',
        expirationTime: null,
        keys: { p256dh: 'key', auth: 'auth' },
      },
    ])
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode: 500 })

    await sendTestNotification('https://app.example.com')

    expect(removeById).not.toHaveBeenCalled()
  })
})
