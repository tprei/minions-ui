import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import type { ConnectionStore } from '../../src/state/types'
import type { MemoryEntry } from '../../src/api/types'

vi.mock('../../src/hooks/useTheme', () => ({
  useTheme: () => signal('light'),
}))

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useMediaQuery: () => signal(true),
}))

vi.mock('../../src/hooks/useConfirm', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}))

const mockMemories: MemoryEntry[] = [
  {
    id: 1,
    repo: 'test/repo',
    kind: 'user',
    title: 'Test Memory',
    body: 'Test body',
    status: 'pending',
    sourceSessionId: 'sess1',
    sourceDagId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededBy: null,
    reviewedAt: null,
    pinned: false,
  },
  {
    id: 2,
    repo: 'test/repo',
    kind: 'feedback',
    title: 'Approved Memory',
    body: 'Approved body',
    status: 'approved',
    sourceSessionId: null,
    sourceDagId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededBy: null,
    reviewedAt: Date.now(),
    pinned: false,
  },
]

function makeStore(features: string[], proposalsCount = 0): ConnectionStore {
  const mockClient = {
    getMemories: vi.fn().mockResolvedValue(mockMemories),
    reviewMemory: vi.fn().mockImplementation((id, req) => {
      const mem = mockMemories.find((m) => m.id === id)
      if (!mem) throw new Error('Not found')
      return Promise.resolve({ ...mem, status: req.status, reviewedAt: Date.now() })
    }),
    updateMemory: vi.fn().mockImplementation((id, updates) => {
      const mem = mockMemories.find((m) => m.id === id)
      if (!mem) throw new Error('Not found')
      return Promise.resolve({ ...mem, ...updates, updatedAt: Date.now() })
    }),
    deleteMemory: vi.fn().mockResolvedValue({ ok: true }),
  }

  const statusSignal = signal('connected' as const)
  statusSignal.subscribe = vi.fn().mockReturnValue(() => {})

  return {
    version: signal({
      apiVersion: '1',
      libraryVersion: '1.110.0',
      features,
    }),
    memoryProposalsCount: signal(proposalsCount),
    status: statusSignal,
    client: mockClient,
    sessions: signal([
      {
        id: 'sess1',
        slug: 'test-session',
        status: 'completed' as const,
        command: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        childIds: [],
        needsAttention: false,
        attentionReasons: [],
        quickActions: [],
        mode: 'task',
        conversation: [],
      },
    ]),
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

  it('shows tabs when feature is available', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    await waitFor(() => {
      expect(screen.getByTestId('tab-inbox')).toBeTruthy()
      expect(screen.getByTestId('tab-library')).toBeTruthy()
      expect(screen.getByTestId('tab-archive')).toBeTruthy()
    })
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

  it('loads memories on mount', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    await waitFor(() => {
      expect(store.client.getMemories).toHaveBeenCalled()
    })
  })

  it('shows pending memories in inbox tab', async () => {
    const store = makeStore(['memory'], 1)
    await setup(store)
    await waitFor(() => {
      expect(screen.getByText('Test Memory')).toBeTruthy()
    })
  })

  it('shows approved memories in library tab', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    fireEvent.click(screen.getByTestId('tab-library'))
    await waitFor(() => {
      expect(screen.getByText('Approved Memory')).toBeTruthy()
    })
  })

  it('shows search input', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    await waitFor(() => {
      expect(screen.getByTestId('memory-search-input')).toBeTruthy()
    })
  })

  it('filters memories on search', async () => {
    const store = makeStore(['memory'])
    await setup(store)
    const searchInput = await waitFor(() => screen.getByTestId('memory-search-input'))
    fireEvent.input(searchInput, { target: { value: 'Approved' } })
    fireEvent.submit(searchInput.closest('form')!)
    await waitFor(() => {
      expect(store.client.getMemories).toHaveBeenCalledWith('Approved', 'pending')
    })
  })
})
