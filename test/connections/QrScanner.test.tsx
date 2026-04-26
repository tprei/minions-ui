import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn()
const mockDestroy = vi.fn()

let currentScanner: MockQrScanner | null = null

class MockQrScanner {
  static SCAN_PERIOD = 250
  onDecode: ((result: { data: string }) => void) | null = null

  constructor(
    _video: HTMLVideoElement,
    onDecode: (result: { data: string }) => void,
    _options?: unknown
  ) {
    this.onDecode = onDecode
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    currentScanner = this
  }

  async start() {
    await mockStart()
  }

  stop() {
    mockStop()
  }

  destroy() {
    mockDestroy()
  }
}

vi.mock('qr-scanner', () => ({
  default: MockQrScanner,
}))

describe('QrScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentScanner = null
  })

  async function renderScanner(props: {
    onScan?: (data: unknown) => void
    onError?: (error: string) => void
    onClose?: () => void
  } = {}) {
    const { QrScanner } = await import('../../src/connections/QrScanner')
    const onScan = props.onScan ?? vi.fn()
    const onError = props.onError ?? vi.fn()
    const onClose = props.onClose ?? vi.fn()
    render(<QrScanner onScan={onScan} onError={onError} onClose={onClose} />)
    return { onScan, onError, onClose }
  }

  it('renders video element', async () => {
    await renderScanner()
    expect(screen.getByTestId('qr-video')).toBeTruthy()
  })

  it('starts scanner on mount', async () => {
    await renderScanner()
    await waitFor(() => expect(mockStart).toHaveBeenCalled())
  })

  it('stops and destroys scanner on unmount', async () => {
    const { QrScanner } = await import('../../src/connections/QrScanner')
    const onScan = vi.fn()
    const onError = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<QrScanner onScan={onScan} onError={onError} onClose={onClose} />)
    await waitFor(() => expect(mockStart).toHaveBeenCalled())
    rerender(<div />)
    expect(mockStop).toHaveBeenCalled()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', async () => {
    const { onClose } = await renderScanner()
    const closeBtn = screen.getByTestId('qr-close-btn')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onError if scanner start fails', async () => {
    mockStart.mockRejectedValueOnce(new Error('Camera denied'))
    const { onError } = await renderScanner()
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Camera denied'))
  })

  it('parses valid QR code with baseUrl and token', async () => {
    const onScan = vi.fn()
    const onClose = vi.fn()
    await renderScanner({ onScan, onClose })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    const validData = JSON.stringify({
      baseUrl: 'https://minion.example.com',
      token: 'secret123',
    })

    currentScanner?.onDecode?.({ data: validData })

    await waitFor(() => {
      expect(onScan).toHaveBeenCalledWith({
        baseUrl: 'https://minion.example.com',
        token: 'secret123',
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('parses valid QR code with baseUrl, token, and label', async () => {
    const onScan = vi.fn()
    const onClose = vi.fn()
    await renderScanner({ onScan, onClose })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    const validData = JSON.stringify({
      baseUrl: 'https://minion.example.com',
      token: 'secret123',
      label: 'Production Server',
    })

    currentScanner?.onDecode?.({ data: validData })

    await waitFor(() => {
      expect(onScan).toHaveBeenCalledWith({
        baseUrl: 'https://minion.example.com',
        token: 'secret123',
        label: 'Production Server',
      })
    })
  })

  it('calls onError for invalid JSON', async () => {
    const onError = vi.fn()
    await renderScanner({ onError })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    currentScanner?.onDecode?.({ data: 'not-json' })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/not valid JSON/))
    })
  })

  it('calls onError when baseUrl is missing', async () => {
    const onError = vi.fn()
    await renderScanner({ onError })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    const invalidData = JSON.stringify({
      token: 'secret123',
    })

    currentScanner?.onDecode?.({ data: invalidData })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Invalid QR code: missing baseUrl')
    })
  })

  it('calls onError when token is missing', async () => {
    const onError = vi.fn()
    await renderScanner({ onError })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    const invalidData = JSON.stringify({
      baseUrl: 'https://minion.example.com',
    })

    currentScanner?.onDecode?.({ data: invalidData })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Invalid QR code: missing token')
    })
  })

  it('does not call onScan twice for duplicate scans', async () => {
    const onScan = vi.fn()
    await renderScanner({ onScan })

    await waitFor(() => expect(mockStart).toHaveBeenCalled())

    const validData = JSON.stringify({
      baseUrl: 'https://minion.example.com',
      token: 'secret123',
    })

    currentScanner?.onDecode?.({ data: validData })
    currentScanner?.onDecode?.({ data: validData })

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1))
  })
})
