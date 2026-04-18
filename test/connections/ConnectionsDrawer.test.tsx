import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('idb-keyval', () => ({ del: vi.fn(), get: vi.fn(), set: vi.fn() }))

const setActiveMock = vi.fn()
const removeConnectionMock = vi.fn()

vi.mock('../../src/connections/store', async () => {
  const { signal } = await import('@preact/signals')
  const connections = signal([
    { id: 'c1', label: 'Alpha', baseUrl: 'https://a.example.com', token: 'ta', color: '#3b82f6' },
    { id: 'c2', label: 'Beta', baseUrl: 'https://b.example.com', token: 'tb', color: '#10b981' },
  ])
  const activeId = signal<string | null>('c1')
  return {
    connections,
    activeId,
    setActive: setActiveMock,
    removeConnection: removeConnectionMock,
  }
})

const confirmMock = vi.fn()
vi.mock('../../src/hooks/useConfirm', () => ({
  confirm: confirmMock,
  ConfirmRoot: () => null,
}))

vi.mock('../../src/connections/ConnectionSettings', () => ({
  ConnectionSettings: ({ existing, onClose }: { existing?: { label: string }; onClose: () => void }) => (
    <div data-testid="connection-settings">
      <span data-testid="settings-existing">{existing?.label ?? 'new'}</span>
      <button data-testid="settings-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('ConnectionsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function setup() {
    const { ConnectionsDrawer } = await import('../../src/connections/ConnectionsDrawer')
    const onClose = vi.fn()
    render(<ConnectionsDrawer onClose={onClose} />)
    return { onClose }
  }

  it('renders list of connections', async () => {
    await setup()
    expect(screen.getByTestId('connections-list')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('delete: confirm=true calls removeConnection', async () => {
    confirmMock.mockResolvedValue(true)
    await setup()
    fireEvent.click(screen.getByTestId('drawer-delete-c1'))
    await waitFor(() => expect(removeConnectionMock).toHaveBeenCalledWith('c1'))
  })

  it('delete: confirm=false is a no-op', async () => {
    confirmMock.mockResolvedValue(false)
    await setup()
    fireEvent.click(screen.getByTestId('drawer-delete-c1'))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(removeConnectionMock).not.toHaveBeenCalled()
  })

  it('delete active connection calls setActive(null) first', async () => {
    confirmMock.mockResolvedValue(true)
    await setup()
    fireEvent.click(screen.getByTestId('drawer-delete-c1'))
    await waitFor(() => expect(setActiveMock).toHaveBeenCalledWith(null))
    expect(removeConnectionMock).toHaveBeenCalledWith('c1')
  })

  it('edit opens ConnectionSettings prefilled', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('drawer-edit-c2'))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    expect(screen.getByTestId('settings-existing').textContent).toBe('Beta')
  })

  it('add opens blank ConnectionSettings', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('drawer-add-btn'))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    expect(screen.getByTestId('settings-existing').textContent).toBe('new')
  })

  it('close button calls onClose', async () => {
    const { onClose } = await setup()
    fireEvent.click(screen.getByTestId('drawer-close-btn'))
    expect(onClose).toHaveBeenCalled()
  })
})
