import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'

test.describe('SSE reconnect', () => {
  test('shows retrying after drop and recovers to live', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages'] })
    mock.setSessions([
      {
        id: 's-reconnect',
        slug: 'persist-task',
        status: 'running',
        command: '/task persist',
        childIds: [],
        needsAttention: false,
        attentionReasons: [],
        quickActions: [],
        mode: 'task',
        conversation: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    try {
      await connectToMinion(page, mock, 'Reconnect Minion')

      await expect(page.getByText('live')).toBeVisible({ timeout: 20_000 })

      mock.drop()

      await expect(page.getByText('retrying')).toBeVisible({ timeout: 5_000 })

      await expect(page.getByText('live')).toBeVisible({ timeout: 20_000 })

      await expect(page.getByTestId('universe-node-s-reconnect')).toBeVisible({ timeout: 10_000 })
    } finally {
      await mock.close()
    }
  })
})
