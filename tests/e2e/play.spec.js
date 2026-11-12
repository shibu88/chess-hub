import { test, expect } from '@playwright/test';

const waitYourMove = (page) => expect(page.locator('.status')).toContainText('Your move', { timeout: 25000 });

test('play a move and get a legal engine reply', async ({ page }) => {
  await page.goto('/#/play');
  await page.selectOption('#difficulty', 'beginner');
  await page.click('.controls >> text=New Game');
  await expect(page.locator('.board')).toBeVisible();
  await waitYourMove(page);

  await page.click('[data-square="e2"]');
  await page.click('[data-square="e4"]');

  // first history row: white move = e4, and the engine's reply (2nd cell) fills in
  await expect(page.locator('.history li').first().locator('span').first()).toHaveText('e4');
  await expect(page.locator('.history li').first().locator('span').nth(1)).toHaveText(/\S/, { timeout: 25000 });
});

test('promotion picker from ?fen produces a queen', async ({ page }) => {
  const fen = encodeURIComponent('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  await page.goto('/#/play?fen=' + fen);
  await expect(page.locator('#color')).toHaveValue('w'); // defaults to side to move
  await page.selectOption('#difficulty', 'beginner');
  await page.click('.controls >> text=New Game');
  await waitYourMove(page);

  await page.click('[data-square="a7"]');
  await page.click('[data-square="a8"]');
  await expect(page.locator('.promotion')).toBeVisible();
  await page.click('[aria-label="Promote to queen"]');
  await expect(page.locator('[data-square="a8"]')).toHaveAttribute('aria-label', /queen/i);
});
