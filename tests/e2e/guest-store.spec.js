import { test, expect } from '@playwright/test';

test('a guest can save a finished game and it survives a reload', async ({ page }) => {
  await page.goto('/#/play');
  await page.selectOption('#difficulty', 'beginner');
  await page.click('.controls >> text=New Game');
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.status')).toContainText('Your move', { timeout: 25000 });

  // End the game quickly by resigning (inline confirm), then save.
  await page.click('.game-actions >> text=Resign');
  await expect(page.locator('.resign-confirm')).toBeVisible();
  await page.click('.resign-confirm >> text=Yes, resign');
  await expect(page.locator('.status.game-over')).toBeVisible();
  await page.click('text=Save to My games');
  await expect(page.locator('.save-status')).toContainText('Saved');

  // Reload and confirm the game is still in IndexedDB.
  await page.reload();
  const count = await page.evaluate(async () => {
    const s = await import('/src/store/index.js');
    return (await s.listGames()).length;
  });
  expect(count).toBeGreaterThanOrEqual(1);
});
