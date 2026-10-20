import { expect, test } from '@playwright/test'

test('an employee sees a 30 EUR meals line without a receipt is incomplete', async ({ page }) => {
  await page.goto('/')
  await page.click('button')
  await expect(page.locator('#out')).toHaveText('incomplete')
})
