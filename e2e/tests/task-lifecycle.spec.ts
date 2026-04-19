import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'

const makeSession = (id: string, slug: string, status: 'running' | 'completed' | 'failed' | 'pending') => ({
  id,
  slug,
  status,
  command: `/task ${slug}`,
  childIds: [] as string[],
  needsAttention: false,
  attentionReasons: [] as never[],
  quickActions: [] as never[],
  mode: 'task',
  conversation: [] as never[],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

test.describe('task lifecycle', () => {
  test('sends message, receives session_created, opens chat, status updates', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages'] })
    mock.setSessions([makeSession('seed-1', 'seed-task', 'running')])

    try {
      await connectToMinion(page, mock, 'My Minion')

      await expect(page.getByTestId('session-item-seed-1')).toBeVisible({ timeout: 8_000 })

      await page.getByTestId('session-item-seed-1').click()

      await expect(page.getByTestId('message-textarea')).toBeVisible()

      await page.getByTestId('message-textarea').fill('/task hello')
      await page.getByTestId('send-btn').click()

      await expect
        .poll(() => mock.lastMessages[0]?.text, { timeout: 5_000 })
        .toBe('/task hello')

      mock.emit({ type: 'session_created', session: makeSession('new-1', 'hello-task', 'running') })

      await expect(page.getByTestId('session-item-new-1')).toBeVisible({ timeout: 5_000 })

      await page.getByTestId('session-item-new-1').click()

      await expect(page.getByTestId('message-textarea')).toBeVisible()

      await page.getByTestId('message-textarea').fill('/stop')
      await page.getByTestId('send-btn').click()

      await expect
        .poll(() => mock.lastMessages[1]?.text, { timeout: 5_000 })
        .toBe('/stop')

      const completedSession = makeSession('new-1', 'hello-task', 'completed')
      mock.setSessions([makeSession('seed-1', 'seed-task', 'running'), completedSession])
      mock.emit({ type: 'session_updated', session: completedSession })

      await expect(page.getByTestId('session-item-new-1')).toContainText('completed', { timeout: 8_000 })
    } finally {
      await mock.close()
    }
  })
})
