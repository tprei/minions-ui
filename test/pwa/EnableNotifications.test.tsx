import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'

const enablePushMock = vi.fn()
const disablePushMock = vi.fn()
const getCurrentSubscriptionMock = vi.fn()
const detectPushSupportMock = vi.fn()
const isPushFlagEnabledMock = vi.fn()
const getNotificationPermissionMock = vi.fn()

vi.mock('../../src/pwa/push', () => ({
  enablePush: enablePushMock,
  disablePush: disablePushMock,
  getCurrentSubscription: getCurrentSubscriptionMock,
  detectPushSupport: detectPushSupportMock,
  isPushFlagEnabled: isPushFlagEnabledMock,
  getNotificationPermission: getNotificationPermissionMock,
}))

const fakeClient = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  isPushFlagEnabledMock.mockReturnValue(true)
  detectPushSupportMock.mockReturnValue({ kind: 'supported' })
  getCurrentSubscriptionMock.mockResolvedValue(null)
  getNotificationPermissionMock.mockReturnValue('default')
})

afterEach(() => {
  vi.resetModules()
})

describe('EnableNotifications', () => {
  it('renders nothing when flag is disabled', async () => {
    isPushFlagEnabledMock.mockReturnValue(false)
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    const { container } = render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows feature-missing message when hasFeature=false', async () => {
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={false} />)
    expect(screen.getByTestId('push-feature-missing')).toBeTruthy()
  })

  it('shows unsupported message when not supported', async () => {
    detectPushSupportMock.mockReturnValue({ kind: 'no-push-manager' })
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    expect(screen.getByTestId('push-unsupported').textContent).toContain('Web Push API')
  })

  it('shows Enable button when no current subscription', async () => {
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-enable-btn')).toBeTruthy())
    expect(screen.queryByTestId('push-disable-btn')).toBeNull()
  })

  it('shows Disable button when already subscribed', async () => {
    getCurrentSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/x',
    })
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-disable-btn')).toBeTruthy())
  })

  it('calls enablePush and shows status on success', async () => {
    enablePushMock.mockResolvedValue({ ok: true, subscription: { endpoint: 'x' } })
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-enable-btn')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('push-enable-btn'))
    })
    await waitFor(() => expect(screen.getByTestId('push-status')).toBeTruthy())
    expect(enablePushMock).toHaveBeenCalledWith(fakeClient)
    expect(screen.getByTestId('push-status').textContent).toContain('enabled')
    expect(screen.getByTestId('push-disable-btn')).toBeTruthy()
  })

  it('shows error message when permission is denied via enablePush result', async () => {
    enablePushMock.mockResolvedValue({ ok: false, reason: 'permission-denied' })
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-enable-btn')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('push-enable-btn'))
    })
    await waitFor(() => expect(screen.getByTestId('push-error')).toBeTruthy())
    expect(screen.getByTestId('push-error').textContent).toMatch(/denied/i)
  })

  it('disables Enable button and shows hint when permission is already denied', async () => {
    getNotificationPermissionMock.mockReturnValue('denied')
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-enable-btn')).toBeTruthy())
    expect((screen.getByTestId('push-enable-btn') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('push-denied-hint')).toBeTruthy()
  })

  it('calls disablePush when Disable is clicked', async () => {
    getCurrentSubscriptionMock.mockResolvedValue({ endpoint: 'x' })
    disablePushMock.mockResolvedValue({ ok: true })
    const { EnableNotifications } = await import('../../src/pwa/EnableNotifications')
    render(<EnableNotifications client={fakeClient} hasFeature={true} />)
    await waitFor(() => expect(screen.getByTestId('push-disable-btn')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('push-disable-btn'))
    })
    await waitFor(() => expect(screen.getByTestId('push-status')).toBeTruthy())
    expect(disablePushMock).toHaveBeenCalledWith(fakeClient)
    expect(screen.getByTestId('push-enable-btn')).toBeTruthy()
  })
})
