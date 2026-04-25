import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuickActionsBar } from '../../src/chat/QuickActionsBar'
import type { QuickAction, ApiSession } from '../../src/api/types'

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

function createSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'sess-123',
    slug: 'test-session',
    status: 'running',
    command: 'test task',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: actions,
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

describe('QuickActionsBar', () => {
  describe('non-ship modes', () => {
    it('renders N buttons for N actions', () => {
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Make PR')).toBeTruthy()
      expect(screen.getByText('Retry')).toBeTruthy()
      expect(screen.getByText('Resume')).toBeTruthy()
    })

    it('renders nothing when actions is empty', () => {
      const session = createSession({ quickActions: [] })
      const { container } = render(
        <QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('calls onAction with the matching QuickAction when button is clicked', async () => {
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByText('Make PR'))
      expect(onAction).toHaveBeenCalledWith(actions[0])
    })

    it('calls onAction with the correct action for each button', async () => {
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByText('Retry'))
      expect(onAction).toHaveBeenCalledWith(actions[1])
      fireEvent.click(screen.getByText('Resume'))
      expect(onAction).toHaveBeenCalledWith(actions[2])
    })
  })

  describe('ship mode', () => {
    it('renders "Move to plan" button for think stage', () => {
      const session = createSession({ mode: 'ship', stage: 'think' })
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      expect(screen.getByText('Move to plan')).toBeTruthy()
    })

    it('calls onShipAdvance with "plan" when think stage button is clicked', async () => {
      const session = createSession({ mode: 'ship', stage: 'think' })
      const onShipAdvance = vi.fn().mockResolvedValue(undefined)
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={onShipAdvance}
        />
      )
      fireEvent.click(screen.getByTestId('ship-advance-btn'))
      expect(onShipAdvance).toHaveBeenCalledWith('plan')
    })

    it('renders "Start DAG" button for plan stage', () => {
      const session = createSession({ mode: 'ship', stage: 'plan' })
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      expect(screen.getByText('Start DAG')).toBeTruthy()
    })

    it('calls onShipAdvance with "dag" when plan stage button is clicked', async () => {
      const session = createSession({ mode: 'ship', stage: 'plan' })
      const onShipAdvance = vi.fn().mockResolvedValue(undefined)
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={onShipAdvance}
        />
      )
      fireEvent.click(screen.getByTestId('ship-advance-btn'))
      expect(onShipAdvance).toHaveBeenCalledWith('dag')
    })

    it('renders disabled "Watching N children" button for dag stage', () => {
      const session = createSession({ mode: 'ship', stage: 'dag', childIds: ['child-1', 'child-2', 'child-3'] })
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      const btn = screen.getByTestId('ship-advance-btn') as HTMLButtonElement
      expect(btn.textContent).toBe('Watching 3 children')
      expect(btn.disabled).toBe(true)
    })

    it('does not call onShipAdvance when dag stage button is clicked', async () => {
      const session = createSession({ mode: 'ship', stage: 'dag', childIds: ['child-1'] })
      const onShipAdvance = vi.fn().mockResolvedValue(undefined)
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={onShipAdvance}
        />
      )
      fireEvent.click(screen.getByTestId('ship-advance-btn'))
      expect(onShipAdvance).not.toHaveBeenCalled()
    })

    it('renders "Mark done" button for verify stage', () => {
      const session = createSession({ mode: 'ship', stage: 'verify' })
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      expect(screen.getByText('Mark done')).toBeTruthy()
    })

    it('calls onShipAdvance with "done" when verify stage button is clicked', async () => {
      const session = createSession({ mode: 'ship', stage: 'verify' })
      const onShipAdvance = vi.fn().mockResolvedValue(undefined)
      render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={onShipAdvance}
        />
      )
      fireEvent.click(screen.getByTestId('ship-advance-btn'))
      expect(onShipAdvance).toHaveBeenCalledWith('done')
    })

    it('renders nothing for done stage', () => {
      const session = createSession({ mode: 'ship', stage: 'done' })
      const { container } = render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders nothing when ship mode has no stage and no quick actions', () => {
      const session = createSession({ mode: 'ship', stage: undefined, quickActions: [] })
      const { container } = render(
        <QuickActionsBar
          session={session}
          onAction={vi.fn().mockResolvedValue(undefined)}
          onShipAdvance={vi.fn().mockResolvedValue(undefined)}
        />
      )
      expect(container.firstChild).toBeNull()
    })
  })
})
