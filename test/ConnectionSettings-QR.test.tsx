import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { ConnectionSettings } from '../src/connections/ConnectionSettings'

vi.mock('../src/api/client', () => ({
  createApiClient: vi.fn(() => ({
    getVersion: vi.fn().mockResolvedValue({
      apiVersion: '1.0',
      libraryVersion: '1.110.0',
      features: [],
    }),
  })),
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

vi.mock('../src/connections/store', () => ({
  addConnection: vi.fn((conn) => ({ ...conn, id: 'test-id' })),
  updateConnection: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('../src/pwa/push', () => ({
  isPushFlagEnabled: vi.fn(() => false),
}))

vi.mock('html5-qrcode', () => {
  return {
    Html5Qrcode: vi.fn().mockImplementation(() => {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockReturnValue(3),
      }
    }),
    Html5QrcodeScannerState: {
      SCANNING: 3,
    },
  }
})

describe('ConnectionSettings QR integration', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      configurable: true,
    })
  })

  it('shows scan QR button for new connections', () => {
    render(<ConnectionSettings onClose={mockOnClose} />)
    expect(screen.getByTestId('scan-qr-btn')).toBeTruthy()
  })

  it('does not show scan QR button for existing connections', () => {
    const existing = {
      id: 'test-1',
      label: 'Test',
      baseUrl: 'https://test.com',
      token: 'token',
      color: '#3b82f6',
    }
    render(<ConnectionSettings onClose={mockOnClose} existing={existing} />)
    expect(screen.queryByTestId('scan-qr-btn')).toBeNull()
  })

  it('opens QR scanner when scan button is clicked', async () => {
    const user = userEvent.setup()
    render(<ConnectionSettings onClose={mockOnClose} />)

    const scanBtn = screen.getByTestId('scan-qr-btn')
    await user.click(scanBtn)

    expect(screen.getByTestId('qr-scanner')).toBeTruthy()
  })

  it('populates fields from scanned QR data', async () => {
    const user = userEvent.setup()
    render(<ConnectionSettings onClose={mockOnClose} />)

    const scanBtn = screen.getByTestId('scan-qr-btn')
    await user.click(scanBtn)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const input = screen.getByTestId('manual-input') as HTMLTextAreaElement
    const qrData = JSON.stringify({
      baseUrl: 'https://scanned.example.com',
      token: 'scanned-token',
      label: 'Scanned Minion',
    })

    await user.click(input)
    await user.paste(qrData)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('qr-scanner')).toBeNull()
    })

    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    const baseUrlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement
    const tokenInput = screen.getByPlaceholderText('bearer token') as HTMLInputElement

    expect(labelInput.value).toBe('Scanned Minion')
    expect(baseUrlInput.value).toBe('https://scanned.example.com')
    expect(tokenInput.value).toBe('scanned-token')
  })

  it('populates fields from scanned QR without label', async () => {
    const user = userEvent.setup()
    render(<ConnectionSettings onClose={mockOnClose} />)

    const scanBtn = screen.getByTestId('scan-qr-btn')
    await user.click(scanBtn)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const input = screen.getByTestId('manual-input') as HTMLTextAreaElement
    const qrData = JSON.stringify({
      baseUrl: 'https://scanned.example.com',
      token: 'scanned-token',
    })

    await user.click(input)
    await user.paste(qrData)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('qr-scanner')).toBeNull()
    })

    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    const baseUrlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement
    const tokenInput = screen.getByPlaceholderText('bearer token') as HTMLInputElement

    expect(labelInput.value).toBe('')
    expect(baseUrlInput.value).toBe('https://scanned.example.com')
    expect(tokenInput.value).toBe('scanned-token')
  })
})
