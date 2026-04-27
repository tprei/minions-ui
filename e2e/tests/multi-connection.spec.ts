import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'

test.describe('multi-connection', () => {
  test('two connections show separate sessions and picker reflects active', async ({ page }) => {
    const mockA = await createMockMinion({ token: 'tokenA' })
    const mockB = await createMockMinion({ token: 'tokenB' })

    mockA.setVersion({ features: ['messages'] })
    mockB.setVersion({ features: ['messages'] })

    mockA.setSessions([
      {
        id: 'a-session',
        slug: 'alpha-task',
        status: 'running',
        command: '/task alpha',
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
    mockB.setSessions([
      {
        id: 'b-session',
        slug: 'beta-task',
        status: 'completed',
        command: '/task beta',
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
      await connectToMinion(page, mockA, 'Minion Alpha')

      await expect(page.getByTestId('session-item-a-session')).toBeVisible({ timeout: 8_000 })

      await page.getByTestId('connection-picker-trigger').click()
      const pickerPopup = page.getByTestId('connection-picker-dropdown').or(page.getByTestId('connection-picker-sheet'))
      await expect(pickerPopup).toBeVisible()

      await page.getByTestId('picker-manage-btn').click()

      await expect(page.getByTestId('connections-drawer')).toBeVisible()

      await page.getByTestId('drawer-add-btn').click()

      await page.getByPlaceholder('My minion').fill('Minion Beta')
      await page.getByPlaceholder('https://your-minion.fly.dev').fill(mockB.url)
      await page.getByPlaceholder('bearer token').fill(mockB.token)
      await page.getByTestId('connections-drawer').getByRole('button', { name: 'Connect', exact: true }).click()

      await page.getByTestId('drawer-close-btn').click()

      await expect(page.getByTestId('connection-picker-trigger')).toContainText('Minion Beta')

      await expect(page.getByTestId('session-item-b-session')).toBeVisible({ timeout: 8_000 })
      await expect(page.getByTestId('session-item-a-session')).not.toBeVisible()

      await page.getByTestId('connection-picker-trigger').click()
      const pickerPopup2 = page.getByTestId('connection-picker-dropdown').or(page.getByTestId('connection-picker-sheet'))
      await expect(pickerPopup2).toBeVisible()

      const alphaOption = pickerPopup2.getByRole('option').filter({ hasText: 'Minion Alpha' })
      await alphaOption.click()

      await expect(page.getByTestId('connection-picker-trigger')).toContainText('Minion Alpha')

      await expect(page.getByTestId('session-item-a-session')).toBeVisible({ timeout: 8_000 })
      await expect(page.getByTestId('session-item-b-session')).not.toBeVisible()
    } finally {
      await mockA.close()
      await mockB.close()
    }
  })
})
