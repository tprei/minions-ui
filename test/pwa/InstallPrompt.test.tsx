import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/preact'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
}))

describe('InstallPrompt', () => {
  beforeEach(() => {
    localStorage.removeItem('minions-ui:install-dismissed')
    localStorage.removeItem('minions-ui:installed')
    vi.resetModules()
  })

  afterEach(() => {
    localStorage.removeItem('minions-ui:install-dismissed')
    localStorage.removeItem('minions-ui:installed')
    vi.resetModules()
  })

  it('renders banner when beforeinstallprompt fires', async () => {
    const { InstallPrompt } = await import('../../src/pwa/InstallPrompt')
    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const promptEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })

    await act(async () => {
      window.dispatchEvent(promptEvent)
    })

    render(<InstallPrompt />)
    expect(screen.getByTestId('install-prompt')).toBeTruthy()
  })

  it('calls prompt() when Install is clicked', async () => {
    const { InstallPrompt } = await import('../../src/pwa/InstallPrompt')
    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const promptEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })

    await act(async () => {
      window.dispatchEvent(promptEvent)
    })

    render(<InstallPrompt />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('install-btn'))
    })

    expect(mockPrompt).toHaveBeenCalledTimes(1)
  })

  it('sets dismiss flag and hides banner when dismissed', async () => {
    const { InstallPrompt } = await import('../../src/pwa/InstallPrompt')
    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const promptEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    })

    await act(async () => {
      window.dispatchEvent(promptEvent)
    })

    const { unmount } = render(<InstallPrompt />)
    fireEvent.click(screen.getByTestId('install-dismiss-btn'))
    unmount()

    expect(localStorage.getItem('minions-ui:install-dismissed')).toBe('true')

    render(<InstallPrompt />)
    expect(screen.queryByTestId('install-prompt')).toBeNull()
  })
})
