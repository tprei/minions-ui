import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import type { ConnectionStore } from '../../src/state/types'

vi.mock('../../src/hooks/useTheme', () => ({
  useTheme: () => signal('light'),
}))

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(true),
}))

function makeStore(features: string[], proposalsCount = 0): ConnectionStore {
  return {
    version: signal({
      apiVersion: '1',
      libraryVersion: '1.110.0',
      features,
    }),
    memoryProposalsCount: signal(proposalsCount),
  } as unknown as ConnectionStore
}

describe('MemoryDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setup(store: ConnectionStore, onClose = vi.fn()) {
    const { MemoryDrawer } = await import('../../src/components/MemoryDrawer')
    render(<MemoryDrawer store={store} onClose={onClose} />)
    return { onClose }
  }

  it('renders when feature is available', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    expect(screen.getByTestId('memory-drawer')).toBeTruthy()
  })

  it('shows placeholder when feature is available', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    expect(screen.getByText(/Memory drawer implementation coming soon/i)).toBeTruthy()
  })

  it('shows upgrade notice when feature is not available', async () => {
    const store = makeStore([])
    await setup(store)
    expect(screen.getByText(/Memory not available/i)).toBeTruthy()
    expect(screen.getByText(/does not support the memory feature/i)).toBeTruthy()
  })

  it('close button calls onClose', async () => {
    const store = makeStore(['memory'])
    const { onClose } = await setup(store)
    fireEvent.click(screen.getByTestId('memory-drawer-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('escape key calls onClose', async () => {
    const store = makeStore(['memory'])
    const { onClose } = await setup(store)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows proposals count badge when count > 0', async () => {
    const store = makeStore(['memory'], 3)
    await setup(store)
    const badge = screen.getByTestId('memory-proposals-badge')
    expect(badge.textContent).toBe('3')
  })

  it('hides proposals count badge when count = 0', async () => {
    const store = makeStore(['memory'], 0)
    await setup(store)
    expect(screen.queryByTestId('memory-proposals-badge')).toBeFalsy()
  })

  it('backdrop click calls onClose', async () => {
    const store = makeStore(['memory'])
    const { onClose } = await setup(store)
    fireEvent.click(screen.getByTestId('drawer-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
