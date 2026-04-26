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
    it('renders all buttons when under threshold (desktop)', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query !== '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Make PR')).toBeTruthy()
      expect(screen.getByText('Retry')).toBeTruthy()
      expect(screen.getByText('Resume')).toBeTruthy()
      expect(screen.queryByTestId('quick-actions-menu-trigger')).toBeNull()
    })

    it('renders nothing when actions is empty', () => {
      const session = createSession({ quickActions: [] })
      const { container } = render(
        <QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('calls onAction with the matching QuickAction when button is clicked', async () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query !== '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByText('Make PR'))
      expect(onAction).toHaveBeenCalledWith(actions[0])
    })

    it('calls onAction with the correct action for each button', async () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query !== '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByText('Retry'))
      expect(onAction).toHaveBeenCalledWith(actions[1])
      fireEvent.click(screen.getByText('Resume'))
      expect(onAction).toHaveBeenCalledWith(actions[2])
    })

    it('shows overflow menu on mobile when more than 2 actions', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Make PR')).toBeTruthy()
      expect(screen.getByText('Retry')).toBeTruthy()
      expect(screen.queryByText('Resume')).toBeNull()
      expect(screen.getByTestId('quick-actions-menu-trigger')).toBeTruthy()
    })

    it('shows overflow menu on desktop when more than 5 actions', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query !== '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const manyActions: QuickAction[] = [
        { type: 'action1', label: 'Action 1', message: '/a1' },
        { type: 'action2', label: 'Action 2', message: '/a2' },
        { type: 'action3', label: 'Action 3', message: '/a3' },
        { type: 'action4', label: 'Action 4', message: '/a4' },
        { type: 'action5', label: 'Action 5', message: '/a5' },
        { type: 'action6', label: 'Action 6', message: '/a6' },
      ]
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Action 1')).toBeTruthy()
      expect(screen.getByText('Action 5')).toBeTruthy()
      expect(screen.queryByText('Action 6')).toBeNull()
      expect(screen.getByTestId('quick-actions-menu-trigger')).toBeTruthy()
    })

    it('opens overflow menu when trigger is clicked', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.queryByTestId('quick-actions-menu')).toBeNull()
      fireEvent.click(screen.getByTestId('quick-actions-menu-trigger'))
      expect(screen.getByTestId('quick-actions-menu')).toBeTruthy()
      expect(screen.getByText('Resume')).toBeTruthy()
    })

    it('calls onAction and closes menu when overflow action is clicked', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByTestId('quick-actions-menu-trigger'))
      expect(screen.getByTestId('quick-actions-menu')).toBeTruthy()
      fireEvent.click(screen.getByText('Resume'))
      expect(onAction).toHaveBeenCalledWith(actions[2])
      expect(screen.queryByTestId('quick-actions-menu')).toBeNull()
    })

    it('closes menu when clicking outside', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      fireEvent.click(screen.getByTestId('quick-actions-menu-trigger'))
      expect(screen.getByTestId('quick-actions-menu')).toBeTruthy()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByTestId('quick-actions-menu')).toBeNull()
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
