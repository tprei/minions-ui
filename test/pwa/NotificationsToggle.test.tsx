import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/preact'

describe('NotificationsToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when Notification API is unavailable', async () => {
    vi.stubGlobal('Notification', undefined)
    const { NotificationsToggle } = await import('../../src/pwa/NotificationsToggle')
    const { container } = render(<NotificationsToggle />)
    expect(container.innerHTML).toBe('')
  })

  it('renders enable button when supported but disabled', async () => {
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('Notification', Notif)

    const { NotificationsToggle } = await import('../../src/pwa/NotificationsToggle')
    render(<NotificationsToggle />)
    const btn = screen.getByTestId('header-notifications-toggle') as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('enables notifications and flips aria-pressed when clicked', async () => {
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('Notification', Notif)

    const { NotificationsToggle } = await import('../../src/pwa/NotificationsToggle')
    render(<NotificationsToggle />)
    const btn = screen.getByTestId('header-notifications-toggle') as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByTestId('header-notifications-toggle').getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('disables when permission is denied and not enabled', async () => {
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, {
      permission: 'denied',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    vi.stubGlobal('Notification', Notif)

    const { NotificationsToggle } = await import('../../src/pwa/NotificationsToggle')
    render(<NotificationsToggle />)
    const btn = screen.getByTestId('header-notifications-toggle') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('renders the menu variant when variant=menu', async () => {
    const Notif = vi.fn() as unknown as typeof Notification
    Object.assign(Notif, {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('Notification', Notif)

    const { NotificationsToggle } = await import('../../src/pwa/NotificationsToggle')
    render(<NotificationsToggle variant="menu" />)
    expect(screen.getByTestId('menu-notifications-toggle')).toBeTruthy()
  })
})
