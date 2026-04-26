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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
    'value',
  )?.set?.call(input, value)
  fireEvent.input(input)
}

describe('MemoryEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setup(memory = mockMemory, onSave = vi.fn(), onCancel = vi.fn()) {
    const { MemoryEditor } = await import('../../src/components/MemoryEditor')
    render(<MemoryEditor memory={memory} onSave={onSave} onCancel={onCancel} />)
    return { onSave, onCancel }
  }

  it('renders editor dialog', async () => {
    await setup()
    expect(screen.getByTestId('memory-editor')).toBeTruthy()
  })

  it('prefills title input with memory title', async () => {
    await setup()
    const titleInput = screen.getByPlaceholderText('Memory title') as HTMLInputElement
    expect(titleInput.value).toBe('Test Memory')
  })

  it('prefills body textarea with memory body', async () => {
    await setup()
    const bodyInput = screen.getByPlaceholderText('Memory content') as HTMLTextAreaElement
    expect(bodyInput.value).toBe('Test body content')
  })

  it('prefills pinned checkbox', async () => {
    await setup({ ...mockMemory, pinned: true })
    const pinnedCheckbox = screen.getByLabelText(
      /Pin this memory/i,
    ) as HTMLInputElement
    expect(pinnedCheckbox.checked).toBe(true)
  })

  it('shows memory kind', async () => {
    await setup()
    expect(screen.getByText('Type: User')).toBeTruthy()
  })

  it('calls onSave with updated values on submit', async () => {
    const { onSave } = await setup()
    const titleInput = screen.getByPlaceholderText('Memory title') as HTMLInputElement
    const bodyInput = screen.getByPlaceholderText('Memory content') as HTMLTextAreaElement
    const pinnedCheckbox = screen.getByLabelText(/Pin this memory/i) as HTMLInputElement

    setInputValue(titleInput, 'Updated Title')
    setInputValue(bodyInput, 'Updated body')
    fireEvent.change(pinnedCheckbox, { target: { checked: true } })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(saveBtn)

    expect(onSave).toHaveBeenCalledWith({
      title: 'Updated Title',
      body: 'Updated body',
      pinned: true,
    })
  })

  it('calls onCancel when cancel button clicked', async () => {
    const { onCancel } = await setup()
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables save button when title is empty', async () => {
    const { onSave } = await setup()
    const titleInput = screen.getByPlaceholderText('Memory title') as HTMLInputElement
    setInputValue(titleInput, '')
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    fireEvent.click(saveBtn)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables save button when body is empty', async () => {
    const { onSave } = await setup()
    const bodyInput = screen.getByPlaceholderText('Memory content') as HTMLTextAreaElement
    setInputValue(bodyInput, '')
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    fireEvent.click(saveBtn)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onCancel when backdrop clicked', async () => {
    const { onCancel } = await setup()
    const backdrop = screen.getByTestId('memory-editor')
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not call onCancel when dialog content clicked', async () => {
    const { onCancel } = await setup()
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(saveBtn.parentElement!.parentElement!)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
