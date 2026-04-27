import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'

test.describe('connection flow', () => {
  test('connects to a minion and shows active state', async ({ page }) => {
    const mock = await createMockMinion({
      token: 'test-token',
      allowedOrigin: '*',
    })
    mock.setVersion({ features: ['messages', 'auth', 'cors-allowlist'] })

    try {
      await page.addInitScript(() => {
        try { localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed') } catch { /* ignore */ }
      })
      await page.goto('/')

      await expect(page.getByRole('heading', { name: 'Connect a minion' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add connection' })).toBeVisible()

      await page.getByRole('button', { name: 'Add connection' }).click()

      await page.getByPlaceholder('My minion').fill('Test Minion')
      await page.getByPlaceholder('https://your-minion.fly.dev').fill(mock.url)
      await page.getByPlaceholder('bearer token').fill(mock.token)

      await page.getByRole('button', { name: 'Connect' }).click()

      await expect(page.getByTestId('connection-picker-trigger')).toBeVisible()
      await expect(page.getByTestId('connection-picker-trigger')).toContainText('Test Minion')

      await expect(page.getByRole('heading', { name: 'Connect a minion' })).not.toBeVisible()
    } finally {
      await mock.close()
    }
  })

  test('fetches sessions and dags after connecting', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages'] })
    mock.setSessions([
      {
        id: 's1',
        slug: 'my-task',
        status: 'running',
        command: '/task hello',
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
      await page.getByPlaceholder('My minion').fill('Minion A')
      await page.getByPlaceholder('https://your-minion.fly.dev').fill(mock.url)
      await page.getByPlaceholder('bearer token').fill(mock.token)
      await page.getByRole('button', { name: 'Connect' }).click()

      await expect(page.getByTestId('connection-picker-trigger')).toContainText('Minion A')

      await expect(page.getByTestId('session-item-s1')).toBeVisible({ timeout: 8_000 })
    } finally {
      await mock.close()
    }
  })
})
