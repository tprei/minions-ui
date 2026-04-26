import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('idb-keyval', () => ({ del: vi.fn(), get: vi.fn(), set: vi.fn() }))

const mockQrStart = vi.fn().mockResolvedValue(undefined)
const mockQrStop = vi.fn()
const mockQrDestroy = vi.fn()

let currentQrScanner: MockQrScanner | null = null

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
    currentQrScanner = this
  }

  async start() {
    await mockQrStart()
  }

  stop() {
    mockQrStop()
  }

  destroy() {
    mockQrDestroy()
  }
}

vi.mock('qr-scanner', () => ({
  default: MockQrScanner,
}))

const addConnectionMock = vi.fn().mockReturnValue({ id: 'new1', label: 'Test', baseUrl: 'https://t.example.com', token: '', color: '#3b82f6' })
const updateConnectionMock = vi.fn()
const setActiveMock = vi.fn()

vi.mock('../../src/connections/store', () => ({
  addConnection: addConnectionMock,
  updateConnection: updateConnectionMock,
  setActive: setActiveMock,
  connections: { value: [] },
  activeId: { value: null },
}))

vi.mock('../../src/api/client', () => ({
  createApiClient: vi.fn(() => ({
    getVersion: vi.fn().mockResolvedValue({ apiVersion: '1', libraryVersion: '0.1.0', features: ['chat'] }),
  })),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, msg: string) { super(msg); this.status = status }
  },
}))

vi.mock('../../src/pwa/EnableNotifications', () => ({
  EnableNotifications: () => <div data-testid="push-controls" />,
}))

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  fireEvent.input(input)
}

describe('ConnectionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQrStart.mockResolvedValue(undefined)
    currentQrScanner = null
  })

  async function renderSettings(props: Record<string, unknown> = {}) {
    const { ConnectionSettings } = await import('../../src/connections/ConnectionSettings')
    const onClose = vi.fn()
    render(<ConnectionSettings onClose={onClose} {...props} />)
    return { onClose }
  }

  it('shows "Add connection" title when no existing prop', async () => {
    await renderSettings()
    expect(screen.getByText('Add connection')).toBeTruthy()
  })

  it('shows "Edit connection" title when existing provided', async () => {
    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })
    expect(screen.getByText('Edit connection')).toBeTruthy()
  })

  it('prefills fields when existing prop is provided', async () => {
    await renderSettings({
      existing: { id: 'e1', label: 'My Conn', baseUrl: 'https://e.example.com', token: 'mytoken', color: '#f59e0b' },
    })
    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    expect(labelInput.value).toBe('My Conn')
    const urlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement
    expect(urlInput.value).toBe('https://e.example.com')
  })

  it('calls updateConnection on submit when existing is provided', async () => {
    const { onClose } = await renderSettings({
      existing: { id: 'e1', label: 'My Conn', baseUrl: 'https://e.example.com', token: 'mytoken', color: '#f59e0b' },
    })
    const submitBtn = screen.getByRole('button', { name: 'Save' })
    await act(async () => { fireEvent.click(submitBtn) })
    expect(updateConnectionMock).toHaveBeenCalledWith('e1', expect.objectContaining({ label: 'My Conn' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls addConnection + setActive on submit when no existing', async () => {
    await renderSettings()
    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    const urlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement
    setInputValue(labelInput, 'New')
    setInputValue(urlInput, 'https://new.example.com')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    })
    await waitFor(() => expect(addConnectionMock).toHaveBeenCalled())
    expect(setActiveMock).toHaveBeenCalled()
  })

  it('shows error when label is empty and baseUrl is set', async () => {
    await renderSettings()
    const urlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement
    setInputValue(urlInput, 'https://x.example.com')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    })
    await waitFor(() => expect(screen.getByTestId('settings-error')).toBeTruthy())
    expect(screen.getByTestId('settings-error').textContent).toContain('Label')
  })

  it('shows error when baseUrl is empty and label is set', async () => {
    await renderSettings()
    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    setInputValue(labelInput, 'Test label')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    })
    await waitFor(() => expect(screen.getByTestId('settings-error')).toBeTruthy())
    expect(screen.getByTestId('settings-error').textContent).toContain('Base URL')
  })

  it('clicking a color swatch updates aria-pressed', async () => {
    await renderSettings()
    const swatch = screen.getByTestId('swatch-#10b981')
    fireEvent.click(swatch)
    await waitFor(() => expect(swatch.getAttribute('aria-pressed')).toBe('true'))
  })

  it('custom hex input with valid hex is accepted', async () => {
    await renderSettings()
    const hexInput = screen.getByTestId('custom-hex-input') as HTMLInputElement
    setInputValue(hexInput, '#abcdef')
    expect(hexInput.value).toBe('#abcdef')
  })

  it('custom hex input with invalid value does not change swatch selection', async () => {
    await renderSettings()
    const hexInput = screen.getByTestId('custom-hex-input') as HTMLInputElement
    setInputValue(hexInput, 'notahex')
    const firstSwatch = screen.getByTestId('swatch-#3b82f6')
    expect(firstSwatch.getAttribute('aria-pressed')).toBe('true')
  })

  it('hides push panel when VITE_ENABLE_PUSH is off', async () => {
    vi.stubEnv('VITE_ENABLE_PUSH', '')
    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })
    expect(screen.queryByTestId('push-section')).toBeNull()
    vi.unstubAllEnvs()
  })

  it('shows push panel for existing connection when VITE_ENABLE_PUSH is on', async () => {
    vi.stubEnv('VITE_ENABLE_PUSH', '1')
    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })
    expect(screen.getByTestId('push-section')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('push-controls')).toBeTruthy())
    vi.unstubAllEnvs()
  })

  it('hides push panel for new (unsaved) connection even when flag is on', async () => {
    vi.stubEnv('VITE_ENABLE_PUSH', '1')
    await renderSettings()
    expect(screen.queryByTestId('push-section')).toBeNull()
    vi.unstubAllEnvs()
  })

  it('shows backend badge when server returns a provider for existing connection', async () => {
    const { createApiClient } = await import('../../src/api/client')
    vi.mocked(createApiClient).mockReturnValueOnce({
      getVersion: vi.fn().mockResolvedValue({
        apiVersion: '1',
        libraryVersion: '0.1.0',
        features: [],
        provider: 'codex',
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })

    await waitFor(() => expect(screen.queryByTestId('backend-badge')).not.toBeNull())
    expect(screen.getByTestId('backend-badge').textContent).toContain('Codex')
  })

  it('omits backend badge when server does not return a provider', async () => {
    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })
    // mock returns no provider — badge must not appear
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByTestId('backend-badge')).toBeNull()
  })

  it('shows QR scan button for new connection', async () => {
    await renderSettings()
    expect(screen.getByTestId('scan-qr-btn')).toBeTruthy()
  })

  it('hides QR scan button for existing connection', async () => {
    await renderSettings({
      existing: { id: 'e1', label: 'Old', baseUrl: 'https://old.example.com', token: 'tok', color: '#10b981' },
    })
    expect(screen.queryByTestId('scan-qr-btn')).toBeNull()
  })

  it('shows QR scanner when scan button is clicked', async () => {
    await renderSettings()
    const scanBtn = screen.getByTestId('scan-qr-btn')
    fireEvent.click(scanBtn)
    await waitFor(() => expect(screen.getByTestId('qr-video')).toBeTruthy())
  })

  it('auto-fills form when valid QR code is scanned', async () => {
    await renderSettings()
    const scanBtn = screen.getByTestId('scan-qr-btn')
    fireEvent.click(scanBtn)

    await waitFor(() => expect(mockQrStart).toHaveBeenCalled())

    const validData = JSON.stringify({
      baseUrl: 'https://scanned.example.com',
      token: 'scanned-token-123',
      label: 'Scanned Connection',
    })

    currentQrScanner?.onDecode?.({ data: validData })

    await waitFor(() => {
      expect(screen.queryByTestId('qr-video')).toBeNull()
    })

    const labelInput = screen.getByPlaceholderText('My minion') as HTMLInputElement
    const urlInput = screen.getByPlaceholderText('https://your-minion.fly.dev') as HTMLInputElement

    expect(labelInput.value).toBe('Scanned Connection')
    expect(urlInput.value).toBe('https://scanned.example.com')
  })

  it('shows error when invalid QR code is scanned', async () => {
    await renderSettings()
    const scanBtn = screen.getByTestId('scan-qr-btn')
    fireEvent.click(scanBtn)

    await waitFor(() => expect(mockQrStart).toHaveBeenCalled())

    currentQrScanner?.onDecode?.({ data: 'invalid-json' })

    await waitFor(() => {
      expect(screen.getByTestId('qr-error')).toBeTruthy()
    })
  })

  it('allows switching back to manual entry from QR scanner', async () => {
    await renderSettings()
    const scanBtn = screen.getByTestId('scan-qr-btn')
    fireEvent.click(scanBtn)

    await waitFor(() => expect(screen.getByText('Scan QR Code')).toBeTruthy())

    const manualBtn = screen.getByText('Enter manually')
    fireEvent.click(manualBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('qr-video')).toBeNull()
      expect(screen.getByTestId('scan-qr-btn')).toBeTruthy()
    })
  })
})
