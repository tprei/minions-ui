import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import type { MemoryEntry } from '../../src/api/types'

vi.mock('../../src/hooks/useTheme', () => ({
  useTheme: () => signal('light'),
}))

const mockMemory: MemoryEntry = {
  id: 1,
  repo: 'test/repo',
  kind: 'user',
  title: 'Test Memory',
  body: 'Test body content',
  status: 'pending',
  sourceSessionId: 'sess1',
  sourceDagId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  supersededBy: null,
  reviewedAt: null,
  pinned: false,
}

describe('MemoryRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setup(
    memory = mockMemory,
    props: Record<string, unknown> = {},
  ) {
    const { MemoryRow } = await import('../../src/components/MemoryRow')
    const defaults = {
      onEdit: vi.fn(),
      onApprove: vi.fn(),
      onReject: vi.fn(),
      onDelete: vi.fn(),
      onViewSource: vi.fn(),
      showActions: true,
    }
    render(<MemoryRow memory={memory} {...defaults} {...props} />)
    return { ...defaults, ...props }
  }

  it('renders memory title and body', async () => {
    await setup()
    expect(screen.getByText('Test Memory')).toBeTruthy()
    expect(screen.getByText('Test body content')).toBeTruthy()
  })

  it('shows kind label', async () => {
    await setup()
    expect(screen.getByText('User')).toBeTruthy()
  })

  it('shows status badge', async () => {
    await setup()
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('shows pinned indicator when pinned', async () => {
    await setup({ ...mockMemory, pinned: true })
    expect(screen.getByTitle('Pinned')).toBeTruthy()
  })

  it('hides pinned indicator when not pinned', async () => {
    await setup({ ...mockMemory, pinned: false })
    expect(screen.queryByTitle('Pinned')).toBeFalsy()
  })

  it('shows approve button for pending status', async () => {
    const { onApprove } = await setup({ ...mockMemory, status: 'pending' })
    const btn = screen.getByTestId('approve-button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onApprove).toHaveBeenCalledWith(1)
  })

  it('shows reject button for pending status', async () => {
    const { onReject } = await setup({ ...mockMemory, status: 'pending' })
    const btn = screen.getByTestId('reject-button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onReject).toHaveBeenCalledWith(1)
  })

  it('shows edit button for pending status', async () => {
    const { onEdit } = await setup({ ...mockMemory, status: 'pending' })
    const btn = screen.getByTestId('edit-button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onEdit).toHaveBeenCalledWith(mockMemory)
  })

  it('shows edit button for approved status', async () => {
    const approvedMemory = { ...mockMemory, status: 'approved' as const }
    const { onEdit } = await setup(approvedMemory)
    const btn = screen.getByTestId('edit-button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onEdit).toHaveBeenCalledWith(approvedMemory)
  })

  it('shows delete button when onDelete provided', async () => {
    const { onDelete } = await setup()
    const btn = screen.getByTestId('delete-button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('hides action buttons when showActions is false', async () => {
    await setup(mockMemory, { showActions: false })
    expect(screen.queryByTestId('approve-button')).toBeFalsy()
    expect(screen.queryByTestId('reject-button')).toBeFalsy()
  })

  it('shows view source button when sourceSessionId and onViewSource provided', async () => {
    const { onViewSource } = await setup()
    const btn = screen.getByText('View source')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onViewSource).toHaveBeenCalledWith('sess1')
  })

  it('hides view source button when no sourceSessionId', async () => {
    await setup({ ...mockMemory, sourceSessionId: null })
    expect(screen.queryByText('View source')).toBeFalsy()
  })
})
