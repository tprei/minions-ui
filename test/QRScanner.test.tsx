import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { QRScanner } from '../src/connections/QRScanner'

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

describe('QRScanner', () => {
  const mockOnScan = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders scanner modal', () => {
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)
    expect(screen.getByTestId('qr-scanner')).toBeTruthy()
    expect(screen.getByText('Scan QR code')).toBeTruthy()
  })

  it('closes when close button is clicked', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const closeBtn = screen.getByTestId('scanner-close-btn')
    await user.click(closeBtn)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('switches to manual mode', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    expect(screen.getByText('Paste connection data')).toBeTruthy()
    expect(screen.getByTestId('manual-input')).toBeTruthy()
  })

  it('handles valid manual input', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const input = screen.getByTestId('manual-input') as HTMLTextAreaElement
    const validData = JSON.stringify({
      baseUrl: 'https://test.example.com',
      token: 'test-token-123',
      label: 'Test Minion',
    })

    await user.click(input)
    await user.paste(validData)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    expect(mockOnScan).toHaveBeenCalledWith({
      baseUrl: 'https://test.example.com',
      token: 'test-token-123',
      label: 'Test Minion',
    })
  })

  it('handles manual input without label', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const input = screen.getByTestId('manual-input') as HTMLTextAreaElement
    const validData = JSON.stringify({
      baseUrl: 'https://test.example.com',
      token: 'test-token-123',
    })

    await user.click(input)
    await user.paste(validData)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    expect(mockOnScan).toHaveBeenCalledWith({
      baseUrl: 'https://test.example.com',
      token: 'test-token-123',
      label: undefined,
    })
  })

  it('rejects invalid manual input', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    expect(mockOnScan).not.toHaveBeenCalled()
  })

  it('rejects JSON missing required fields', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    const submitBtn = screen.getByTestId('manual-submit-btn')
    await user.click(submitBtn)

    expect(mockOnScan).not.toHaveBeenCalled()
  })

  it('switches back to camera from manual mode', async () => {
    const user = userEvent.setup()
    render(<QRScanner onScan={mockOnScan} onClose={mockOnClose} />)

    const manualBtn = await waitFor(() => screen.getByTestId('switch-to-manual-btn'))
    await user.click(manualBtn)

    expect(screen.getByText('Paste connection data')).toBeTruthy()

    const backBtn = screen.getByTestId('switch-to-camera-btn')
    await user.click(backBtn)

    await waitFor(() => {
      expect(screen.getByText('Scan QR code')).toBeTruthy()
    })
  })
})
