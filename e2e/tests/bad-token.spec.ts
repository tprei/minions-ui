import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'

test.describe('bad token', () => {
  test('wrong token shows auth error; fixing token loads sessions', async ({ page }) => {
    const mock = await createMockMinion({ token: 'right' })
    mock.setVersion({ features: ['messages'] })
    mock.setSessions([
      {
        id: 'correct-session',
        slug: 'correct-task',
        status: 'running',
        command: '/task correct',
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
      await page.addInitScript(() => {
        try { localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed') } catch { /* ignore */ }
      })
      await page.goto('/')

      await page.getByRole('button', { name: 'Add connection' }).click()

      await page.getByPlaceholder('My minion').fill('Bad Token Minion')
      await page.getByPlaceholder('https://your-minion.fly.dev').fill(mock.url)
      await page.getByPlaceholder('bearer token').fill('wrong')

      await page.getByRole('button', { name: 'Connect' }).click()

      await expect(page.getByTestId('settings-error')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('settings-error')).toContainText('Unauthorized')

      await page.getByPlaceholder('bearer token').fill('right')
      await page.getByRole('button', { name: 'Connect' }).click()

      await expect(page.getByTestId('connection-picker-trigger')).toContainText('Bad Token Minion')

      await expect(page.getByTestId('session-item-correct-session')).toBeVisible({ timeout: 8_000 })
    } finally {
      await mock.close()
    }
  })
})
