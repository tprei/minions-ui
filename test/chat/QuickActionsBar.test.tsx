import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuickActionsBar } from '../../src/chat/QuickActionsBar'
import type { QuickAction } from '../../src/api/types'

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
})

const actions: QuickAction[] = [
  { type: 'make_pr', label: 'Make PR', message: '/ship' },
  { type: 'retry', label: 'Retry', message: '/retry' },
  { type: 'resume', label: 'Resume', message: '/resume' },
]

describe('QuickActionsBar', () => {
  it('renders N buttons for N actions', () => {
    render(<QuickActionsBar actions={actions} onAction={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByText('Make PR')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(screen.getByText('Resume')).toBeTruthy()
  })

  it('renders nothing when actions is empty', () => {
    const { container } = render(
      <QuickActionsBar actions={[]} onAction={vi.fn().mockResolvedValue(undefined)} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('calls onAction with the matching QuickAction when button is clicked', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<QuickActionsBar actions={actions} onAction={onAction} />)
    fireEvent.click(screen.getByText('Make PR'))
    expect(onAction).toHaveBeenCalledWith(actions[0])
  })

  it('calls onAction with the correct action for each button', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<QuickActionsBar actions={actions} onAction={onAction} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(onAction).toHaveBeenCalledWith(actions[1])
    fireEvent.click(screen.getByText('Resume'))
    expect(onAction).toHaveBeenCalledWith(actions[2])
  })
})
