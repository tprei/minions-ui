import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { MockMinion } from '../fixtures/mock-minion'

export async function connectToMinion(
  page: Page,
  mock: MockMinion,
  label: string,
): Promise<void> {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Add connection' })).toBeVisible()

  await page.getByRole('button', { name: 'Add connection' }).click()

  await page.getByPlaceholder('My minion').fill(label)
  await page.getByPlaceholder('https://your-minion.fly.dev').fill(mock.url)
  if (mock.token) {
    await page.getByPlaceholder('bearer token').fill(mock.token)
  }

  await page.getByRole('button', { name: 'Connect' }).click()

  await expect(page.getByTestId('connection-picker-trigger')).toBeVisible()
  await expect(page.getByTestId('connection-picker-trigger')).toContainText(label)
}
