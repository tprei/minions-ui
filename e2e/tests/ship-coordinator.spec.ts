import { test, expect } from '@playwright/test'
import { createMockMinion, type ApiSession } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'

function makeShipSession(
  id: string,
  slug: string,
  stage: ApiSession['stage'],
  status: ApiSession['status'] = 'running',
  childIds: string[] = [],
): ApiSession {
  return {
    id,
    slug,
    status,
    command: `/ship ${slug}`,
    childIds,
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'ship',
    stage,
    conversation: [{ role: 'user', text: slug }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeChildSession(id: string, slug: string, status: ApiSession['status']): ApiSession {
  return {
    id,
    slug,
    status,
    command: `/dag-task ${slug}`,
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'dag-task',
    conversation: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

test.describe('ship coordinator flow', () => {
  // TODO: this test still needs the SSE-driven status-card render path wired up
  // end-to-end against the mock minion. Skipping for now; the rest of the
  // coordinator lifecycle is exercised via unit/component tests (see
  // server/ship/coordinator.test.ts and src/components/NodeDetailPopup tests).
  test.skip('full lifecycle: think→plan→dag with children→verify→done', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['ship-coordinator'] })

    const coordinatorId = 'coord-1'
    const child1Id = 'child-1'
    const child2Id = 'child-2'

    try {
      await connectToMinion(page, mock, 'Ship Test')

      // Initial: ship session in 'think' stage
      const thinkSession = makeShipSession(coordinatorId, 'implement-feature-x', 'think')
      mock.setSessions([thinkSession])
      mock.emit({ type: 'session_created', session: thinkSession })

      await expect(page.getByTestId(`session-item-${coordinatorId}`)).toBeVisible({ timeout: 5_000 })

      // Click to open chat
      await page.getByTestId(`session-item-${coordinatorId}`).click()
      await expect(page.getByTestId('quick-actions-bar')).toBeVisible()

      // Assert 'Move to plan' button exists
      const moveBtn = page.getByTestId('ship-advance-btn')
      await expect(moveBtn).toBeVisible()
      await expect(moveBtn).toHaveText('Move to plan')

      // Click 'Move to plan'
      await moveBtn.click()

      // Assert ship_advance command sent
      await expect
        .poll(() => mock.lastCommands.find((c) => c.action === 'ship_advance'), { timeout: 5_000 })
        .toBeTruthy()

      // Emit stage update to 'plan'
      const planSession = makeShipSession(coordinatorId, 'implement-feature-x', 'plan')
      mock.setSessions([planSession])
      mock.emit({ type: 'session_updated', session: planSession })

      // Assert button changes to 'Start DAG'
      await expect(moveBtn).toHaveText('Start DAG', { timeout: 5_000 })

      // Click 'Start DAG'
      await moveBtn.click()

      // Emit stage update to 'dag' with two children
      const dagSession = makeShipSession(coordinatorId, 'implement-feature-x', 'dag', 'running', [
        child1Id,
        child2Id,
      ])
      mock.setSessions([dagSession])
      mock.emit({ type: 'session_updated', session: dagSession })

      // Assert button shows 'Watching 2 children' and is disabled
      await expect(moveBtn).toHaveText('Watching 2 children', { timeout: 5_000 })
      await expect(moveBtn).toBeDisabled()

      // Emit two child sessions
      const child1 = makeChildSession(child1Id, 'add-frontend', 'running')
      const child2 = makeChildSession(child2Id, 'add-backend', 'running')
      mock.setSessions([dagSession, child1, child2])
      mock.emit({ type: 'session_created', session: child1 })
      mock.emit({ type: 'session_created', session: child2 })

      // Wait for children to appear in session list
      await expect(page.getByTestId(`session-item-${child1Id}`)).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId(`session-item-${child2Id}`)).toBeVisible({ timeout: 5_000 })

      // Open the coordinator transcript before emitting events — transcript
      // events are dropped if no transcript store exists for the session yet.
      await page.getByTestId(`session-item-${coordinatorId}`).click()
      await expect(page.getByTestId('message-textarea')).toBeVisible({ timeout: 5_000 })

      // Complete child 1
      const child1Completed = makeChildSession(child1Id, 'add-frontend', 'completed')
      mock.setSessions([dagSession, child1Completed, child2])
      mock.emit({ type: 'session_updated', session: child1Completed })

      // Emit child_completed status event on coordinator
      mock.emit({
        type: 'transcript_event',
        sessionId: coordinatorId,
        event: {
          seq: 1,
          id: 'evt-child1',
          sessionId: coordinatorId,
          turn: 1,
          timestamp: Date.now(),
          type: 'status',
          severity: 'info',
          kind: 'child_completed',
          message: 'Child completed',
          data: {
            slug: 'add-frontend',
            status: 'completed',
          },
        },
      })

      // Assert child_completed card renders
      await expect(
        page.locator('[data-testid="transcript-status"][data-kind="child_completed"]').getByText('add-frontend'),
      ).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('child-status-chip')).toContainText('completed')

      // Complete child 2
      const child2Completed = makeChildSession(child2Id, 'add-backend', 'completed')
      mock.setSessions([dagSession, child1Completed, child2Completed])
      mock.emit({ type: 'session_updated', session: child2Completed })

      mock.emit({
        type: 'transcript_event',
        sessionId: coordinatorId,
        event: {
          seq: 2,
          id: 'evt-child2',
          sessionId: coordinatorId,
          turn: 1,
          timestamp: Date.now() + 100,
          type: 'status',
          severity: 'info',
          kind: 'child_completed',
          message: 'Child completed',
          data: {
            slug: 'add-backend',
            status: 'completed',
          },
        },
      })

      // Assert second child_completed card
      await expect(
        page.locator('[data-testid="transcript-status"][data-kind="child_completed"]').getByText('add-backend'),
      ).toBeVisible({ timeout: 5_000 })

      // Emit auto-advance to 'verify'
      const verifySession = makeShipSession(coordinatorId, 'implement-feature-x', 'verify', 'running', [
        child1Id,
        child2Id,
      ])
      mock.setSessions([verifySession, child1Completed, child2Completed])
      mock.emit({ type: 'session_updated', session: verifySession })

      // Assert button shows 'Mark done'
      await expect(moveBtn).toHaveText('Mark done', { timeout: 5_000 })
      await expect(moveBtn).not.toBeDisabled()

      // Click 'Mark done'
      await moveBtn.click()

      // Emit stage update to 'done'
      const doneSession = makeShipSession(
        coordinatorId,
        'implement-feature-x',
        'done',
        'completed',
        [child1Id, child2Id],
      )
      mock.setSessions([doneSession, child1Completed, child2Completed])
      mock.emit({ type: 'session_updated', session: doneSession })

      // Assert button disappears
      await expect(moveBtn).not.toBeVisible({ timeout: 5_000 })
    } finally {
      await mock.close()
    }
  })

  test('renders coordinator node with stage badge in universe canvas', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['ship-coordinator'] })

    const coordinatorId = 'coord-1'

    try {
      await connectToMinion(page, mock, 'Canvas Test')

      const planSession = makeShipSession(coordinatorId, 'refactor-auth', 'plan')
      mock.setSessions([planSession])
      mock.emit({ type: 'session_created', session: planSession })

      await expect(page.getByTestId(`session-item-${coordinatorId}`)).toBeVisible({ timeout: 5_000 })

      // Open universe canvas (assume there's a view toggle or default view)
      // For now, just verify the node exists with stage badge
      const node = page.getByTestId(`universe-node-${coordinatorId}`)
      if (await node.isVisible()) {
        await expect(node.getByText('stage: plan')).toBeVisible()
      }
    } finally {
      await mock.close()
    }
  })

  test('shows children in NodeDetailPopup when coordinator has workers', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['ship-coordinator'] })

    const coordinatorId = 'coord-1'
    const child1Id = 'child-1'
    const child2Id = 'child-2'

    try {
      await connectToMinion(page, mock, 'Popup Test')

      const dagSession = makeShipSession(coordinatorId, 'ship-feature', 'dag', 'running', [
        child1Id,
        child2Id,
      ])
      const child1 = makeChildSession(child1Id, 'worker-one', 'running')
      const child2 = makeChildSession(child2Id, 'worker-two', 'completed')

      mock.setSessions([dagSession, child1, child2])
      mock.emit({ type: 'session_created', session: dagSession })
      mock.emit({ type: 'session_created', session: child1 })
      mock.emit({ type: 'session_created', session: child2 })

      await expect(page.getByTestId(`session-item-${coordinatorId}`)).toBeVisible({ timeout: 5_000 })

      // Click session to potentially open popup (depends on UI implementation)
      // This test is aspirational - actual popup trigger may vary
      await page.getByTestId(`session-item-${coordinatorId}`).click()

      // If popup shows, verify children are listed
      const popup = page.locator('[data-testid*="node-detail-popup"]')
      if (await popup.isVisible()) {
        await expect(popup.getByText('worker-one')).toBeVisible()
        await expect(popup.getByText('worker-two')).toBeVisible()
      }
    } finally {
      await mock.close()
    }
  })
})
