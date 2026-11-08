import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err
  })
})

test('a bot game starts, deals and takes a move', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Настроить партию' }).click()
  await page.getByRole('button', { name: /С ботами/ }).click()
  await page.getByRole('switch', { name: /Первый отбой/ }).click()
  await page.getByRole('button', { name: /Начать партию/ }).click()
  const hand = page.getByRole('region', { name: 'Ваши карты' })
  // six cards dealt into the hand
  await expect(hand.locator('button.card')).toHaveCount(6, { timeout: 15_000 })
  // play along until a bot has thought at least once; the bots think in Rust (WebAssembly), not the TypeScript fallback
  const engine = () => page.evaluate(() => (globalThis as { durakBotEngine?: string }).durakBotEngine)
  for (let i = 0; i < 60 && !(await engine()); i++) {
    const playable = hand.locator('button.card.playable')
    if (await playable.count()) await playable.first().dispatchEvent('click').catch(() => {})
    else {
      const main = page.locator('.controls .buttons button.primary:enabled, .controls .buttons button.danger:enabled')
      if (await main.count()) await main.last().dispatchEvent('click').catch(() => {})
    }
    await page.waitForTimeout(500)
  }
  expect(await engine()).toBe('rust')
})

test('a damaged saved game is dropped instead of breaking the app', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => localStorage.setItem('durak.game', JSON.stringify({ players: 'oops', over: false })))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить' })).toHaveCount(0)
})

test('broken settings fall back to defaults', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => localStorage.setItem('durak.settings', JSON.stringify({ deckSize: 'lots', opponents: 'x', name: 5 })))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeVisible()
})
