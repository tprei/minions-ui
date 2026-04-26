import { render, screen, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { MessageInput } from '../../src/chat/MessageInput'
import { ConnectionsDrawer } from '../../src/connections/ConnectionsDrawer'
import { ConnectionPicker } from '../../src/connections/ConnectionPicker'
import { QuickActionsBar } from '../../src/chat/QuickActionsBar'
import { NodeDetailPopup } from '../../src/components/NodeDetailPopup'
import { ConnectionSettings } from '../../src/connections/ConnectionSettings'
import type { ApiSession, QuickAction } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

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

function assertMinTouchTarget(el: HTMLElement, name: string) {
  const classNames = el.className
  const hasMinHeight = classNames.includes('min-h-[44px]') || classNames.includes('min-h-11')
  const hasMinWidth = classNames.includes('min-w-[44px]') || classNames.includes('min-w-11')

  const paddingMatch = classNames.match(/py-(\d+(?:\.\d+)?)/)?.[1]
  const hasSufficientPadding = paddingMatch && parseFloat(paddingMatch) >= 2.5

  const hasValidTouchTarget = hasMinHeight || (hasMinWidth && hasSufficientPadding)

  expect(
    hasValidTouchTarget,
    `${name} should have min-h-[44px] or equivalent touch target classes. Classes: ${classNames}`,
  ).toBe(true)
}

describe('Touch Target Accessibility', () => {
  describe('MessageInput', () => {
    const mockSession: ApiSession = {
      id: 's1',
      slug: 'test',
      status: 'running',
      command: '/task foo',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'task',
      conversation: [],
    }

    const mockStore = {
      version: signal({ apiVersion: '2.0.0', libraryVersion: '0.1.0', features: ['sessions-create-images'] as string[] }),
    } as unknown as ConnectionStore

    function Controlled() {
      const [text, setText] = useState('')
      return <MessageInput session={mockSession} store={mockStore} onSend={vi.fn()} value={text} onValueChange={setText} />
    }

    it('Send button meets 44px minimum touch target', () => {
      render(<Controlled />)
      const sendBtn = screen.getByTestId('send-btn')
      assertMinTouchTarget(sendBtn, 'Send button')
    })

    it('Attach button meets 44px minimum touch target', () => {
      render(<Controlled />)
      const attachBtn = screen.getByTestId('attach-btn')
      assertMinTouchTarget(attachBtn, 'Attach button')
    })
  })

  describe('ConnectionsDrawer', () => {
    it('Close button meets 44px minimum touch target', () => {
      render(<ConnectionsDrawer onClose={vi.fn()} />)
      const closeBtn = screen.getByTestId('drawer-close-btn')
      assertMinTouchTarget(closeBtn, 'Drawer close button')
    })

    it('Back button meets 44px minimum touch target when visible', async () => {
      render(<ConnectionsDrawer onClose={vi.fn()} />)
      const addBtn = screen.getByTestId('drawer-add-btn')
      addBtn.click()
      await waitFor(() => {
        const backBtn = screen.getByTestId('drawer-back-btn')
        assertMinTouchTarget(backBtn, 'Drawer back button')
      })
    })
  })

  describe('ConnectionPicker', () => {
    it('Trigger button meets 44px minimum touch target', () => {
      render(<ConnectionPicker onManage={vi.fn()} />)
      const trigger = screen.getByTestId('connection-picker-trigger')
      assertMinTouchTarget(trigger, 'Connection picker trigger')
    })
  })

  describe('QuickActionsBar', () => {
    const mockSession: ApiSession = {
      id: 's1',
      slug: 'test',
      status: 'running',
      command: '/task foo',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [
        { type: 'approve', label: 'Approve', message: '/approve' },
        { type: 'reject', label: 'Reject', message: '/reject' },
      ] as QuickAction[],
      mode: 'task',
      conversation: [],
    }

    it('Quick action buttons meet 44px minimum touch target', () => {
      render(<QuickActionsBar session={mockSession} onAction={vi.fn()} />)
      const buttons = screen.getAllByRole('button')
      buttons.forEach((btn, i) => {
        assertMinTouchTarget(btn, `Quick action button ${i}`)
      })
    })

    it('Ship advance button meets 44px minimum touch target', () => {
      const shipSession: ApiSession = {
        ...mockSession,
        mode: 'ship',
        stage: 'think',
      }
      render(<QuickActionsBar session={shipSession} onAction={vi.fn()} onShipAdvance={vi.fn()} />)
      const advanceBtn = screen.getByTestId('ship-advance-btn')
      assertMinTouchTarget(advanceBtn, 'Ship advance button')
    })
  })

  describe('NodeDetailPopup', () => {
    const mockSession: ApiSession = {
      id: 's1',
      slug: 'test-session',
      status: 'completed',
      command: '/task test',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'task',
      conversation: [],
      prUrl: 'https://github.com/test/test/pull/1',
    }

    it('Close button meets 44px minimum touch target', () => {
      render(<NodeDetailPopup session={mockSession} onClose={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      const closeBtn = dialog.querySelector('[aria-label="Close"]') as HTMLElement
      expect(closeBtn).toBeTruthy()
      assertMinTouchTarget(closeBtn, 'Popup close button')
    })

    it('Action buttons meet 44px minimum touch target', () => {
      render(<NodeDetailPopup session={mockSession} onClose={vi.fn()} onOpenChat={vi.fn()} onViewLogs={vi.fn()} />)
      const buttons = screen.getAllByRole('button').filter(btn =>
        btn.textContent?.includes('Open Chat') ||
        btn.textContent?.includes('View Logs') ||
        btn.textContent?.includes('View PR')
      )
      buttons.forEach((btn) => {
        assertMinTouchTarget(btn, `${btn.textContent} button`)
      })
    })
  })

  describe('ConnectionSettings', () => {
    it('Submit and Cancel buttons meet 44px minimum touch target', () => {
      render(<ConnectionSettings onClose={vi.fn()} />)
      const buttons = screen.getAllByRole('button')
      const submitBtn = buttons.find(btn => btn.textContent === 'Connect')
      const cancelBtn = buttons.find(btn => btn.textContent === 'Cancel')
      expect(submitBtn).toBeTruthy()
      expect(cancelBtn).toBeTruthy()
      assertMinTouchTarget(submitBtn!, 'Submit button')
      assertMinTouchTarget(cancelBtn!, 'Cancel button')
    })

    it('Color swatch buttons meet 44px minimum touch target', () => {
      render(<ConnectionSettings onClose={vi.fn()} />)
      const swatchContainer = screen.getByTestId('color-swatches')
      const swatches = swatchContainer.querySelectorAll('button')
      swatches.forEach((swatch, i) => {
        assertMinTouchTarget(swatch, `Color swatch ${i}`)
      })
    })
  })
})
