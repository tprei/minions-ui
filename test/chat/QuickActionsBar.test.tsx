import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuickActionsBar } from '../../src/chat/QuickActionsBar'
import type { QuickAction, ApiSession } from '../../src/api/types'

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

beforeEach(() => {
  mockMatchMedia(false)
  if (!navigator.vibrate) {
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      value: vi.fn(),
    })
  }
})

const actions: QuickAction[] = [
  { type: 'make_pr', label: 'Make PR', message: '/ship' },
  { type: 'retry', label: 'Retry', message: '/retry' },
  { type: 'resume', label: 'Resume', message: '/resume' },
]

const manyActions: QuickAction[] = [
  { type: 'make_pr', label: 'Action 1', message: '/action1' },
  { type: 'retry', label: 'Action 2', message: '/action2' },
  { type: 'resume', label: 'Action 3', message: '/action3' },
  { type: 'make_pr', label: 'Action 4', message: '/action4' },
  { type: 'retry', label: 'Action 5', message: '/action5' },
  { type: 'resume', label: 'Action 6', message: '/action6' },
  { type: 'make_pr', label: 'Action 7', message: '/action7' },
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
  describe('non-ship modes (mobile)', () => {
    beforeEach(() => {
      mockMatchMedia(false)
    })

    it('renders nothing when actions is empty', () => {
      const session = createSession({ quickActions: [] })
      const { container } = render(
        <QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders a single trigger button labeled with the action count', () => {
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      const trigger = screen.getByTestId('quick-actions-trigger')
      expect(trigger).toBeTruthy()
      expect(trigger.textContent).toContain('3')
      expect(screen.queryByText('Make PR')).toBeNull()
      expect(screen.queryByText('Retry')).toBeNull()
      expect(screen.queryByText('Resume')).toBeNull()
    })

    it('opens the bottom sheet showing all actions when the trigger is clicked', () => {
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)

      fireEvent.click(screen.getByTestId('quick-actions-trigger'))
      const sheet = screen.getByTestId('quick-actions-sheet')
      expect(sheet).toBeTruthy()
      expect(sheet.textContent).toContain('Make PR')
      expect(sheet.textContent).toContain('Retry')
      expect(sheet.textContent).toContain('Resume')
    })

    it('calls onAction when an action in the sheet is clicked and closes the sheet', () => {
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)

      fireEvent.click(screen.getByTestId('quick-actions-trigger'))
      const sheet = screen.getByTestId('quick-actions-sheet')
      const makePrBtn = Array.from(sheet.querySelectorAll('button')).find(b => b.textContent?.includes('Make PR'))!
      fireEvent.click(makePrBtn)

      expect(onAction).toHaveBeenCalledWith(actions[0])
      expect(screen.queryByTestId('quick-actions-sheet')).toBeNull()
    })

    it('closes the bottom sheet when the backdrop is clicked', () => {
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)

      fireEvent.click(screen.getByTestId('quick-actions-trigger'))
      expect(screen.getByTestId('quick-actions-sheet')).toBeTruthy()
      fireEvent.click(screen.getByTestId('quick-actions-backdrop'))
      expect(screen.queryByTestId('quick-actions-sheet')).toBeNull()
    })

    it('lists all 7 actions in the sheet regardless of count', () => {
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      const trigger = screen.getByTestId('quick-actions-trigger')
      expect(trigger.textContent).toContain('7')

      fireEvent.click(trigger)
      const sheet = screen.getByTestId('quick-actions-sheet')
      for (const action of manyActions) {
        expect(sheet.textContent).toContain(action.label)
      }
    })
  })

  describe('non-ship modes (desktop)', () => {
    beforeEach(() => {
      mockMatchMedia(true)
    })

    it('renders all actions inline when count is below threshold', () => {
      const session = createSession()
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Make PR')).toBeTruthy()
      expect(screen.getByText('Retry')).toBeTruthy()
      expect(screen.getByText('Resume')).toBeTruthy()
      expect(screen.queryByTestId('quick-actions-more-btn')).toBeNull()
    })

    it('calls onAction with the matching QuickAction when an inline button is clicked', () => {
      const session = createSession()
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByText('Make PR'))
      expect(onAction).toHaveBeenCalledWith(actions[0])
    })

    it('shows "More actions..." button when actions exceed desktop threshold', () => {
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByTestId('quick-actions-more-btn')).toBeTruthy()
      expect(screen.getByText(/More actions\.\.\. \(2\)/)).toBeTruthy()
    })

    it('shows first 5 actions directly on desktop', () => {
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      expect(screen.getByText('Action 1')).toBeTruthy()
      expect(screen.getByText('Action 2')).toBeTruthy()
      expect(screen.getByText('Action 3')).toBeTruthy()
      expect(screen.getByText('Action 4')).toBeTruthy()
      expect(screen.getByText('Action 5')).toBeTruthy()
      expect(screen.queryByText('Action 6')).toBeNull()
    })

    it('opens dropdown when "More actions..." is clicked on desktop', () => {
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      fireEvent.click(screen.getByTestId('quick-actions-more-btn'))
      expect(screen.getByTestId('quick-actions-dropdown')).toBeTruthy()
    })

    it('shows overflow actions in dropdown', () => {
      const session = createSession({ quickActions: manyActions })
      render(<QuickActionsBar session={session} onAction={vi.fn().mockResolvedValue(undefined)} />)
      fireEvent.click(screen.getByTestId('quick-actions-more-btn'))
      const dropdown = screen.getByTestId('quick-actions-dropdown')
      expect(dropdown.textContent).toContain('Action 6')
      expect(dropdown.textContent).toContain('Action 7')
    })

    it('calls onAction when overflow action is clicked in dropdown', () => {
      const session = createSession({ quickActions: manyActions })
      const onAction = vi.fn().mockResolvedValue(undefined)
      render(<QuickActionsBar session={session} onAction={onAction} />)
      fireEvent.click(screen.getByTestId('quick-actions-more-btn'))
      const dropdown = screen.getByTestId('quick-actions-dropdown')
      const action6 = Array.from(dropdown.querySelectorAll('button')).find(b => b.textContent?.includes('Action 6'))!
      fireEvent.click(action6)
      expect(onAction).toHaveBeenCalledWith(manyActions[5])
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
