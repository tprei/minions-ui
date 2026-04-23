import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'

test.describe('header layout', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('header does not overflow horizontally on narrow viewports', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages'] })
    try {
      await connectToMinion(page, mock, 'My Minion')

      await expect(page.getByTestId('header-menu-btn')).toBeVisible()
      await page.getByTestId('header-menu-btn').click()
      await expect(page.getByTestId('menu-refresh')).toBeVisible()
      await expect(page.getByTestId('menu-clean')).toBeVisible()

      const headerOverflow = await page
        .locator('header')
        .first()
        .evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(headerOverflow).toBeLessThanOrEqual(0)

      const docOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(docOverflow).toBeLessThanOrEqual(0)
    } finally {
      await mock.close()
    }
  })
})
