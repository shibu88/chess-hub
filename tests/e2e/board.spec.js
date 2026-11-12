import { test, expect } from '@playwright/test';

// Tap a square (board uses tap-to-select then tap-to-move).
const sq = (page, s) => page.click(`.sq[data-square="${s}"]`);

test('Board sub-tab: play moves, step back and replace the rest', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.locator('.board')).toBeVisible();

  // 1.e4 e5 2.Nf3
  await sq(page, 'e2'); await sq(page, 'e4');
  await sq(page, 'e7'); await sq(page, 'e5');
  await sq(page, 'g1'); await sq(page, 'f3');
  await expect(page.locator('.am-moves')).toContainText('e4');
  await expect(page.locator('.am-moves')).toContainText('e5');
  await expect(page.locator('.am-moves')).toContainText('Nf3');

  // Step back to the position after 1.e4 (click the e4 move cell).
  await page.click('.mv:has-text("e4")');
  await expect(page.locator('.status')).toContainText('viewing move 1 of 3');
  // Play a different Black move (1...d5) → a confirm dialog guards the replace.
  await sq(page, 'd7'); await sq(page, 'd5');
  await expect(page.locator('.confirm-dialog')).toBeVisible();
  await page.click('.confirm-dialog button:has-text("Replace")');
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);

  // The rest is gone: d5 is in, Nf3 is not.
  await expect(page.locator('.am-moves')).toContainText('d5');
  await expect(page.locator('.am-moves')).not.toContainText('Nf3');
});

test('Board sub-tab: ANALYZE opens the Review', async ({ page }) => {
  await page.goto('/#/analysis');
  await sq(page, 'e2'); await sq(page, 'e4');
  await page.click('.analyze-btn');
  await expect(page.locator('.review-layout')).toBeVisible();          // Review mounted
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 }); // analysis finished
});

test('Board sub-tab: seeds from ?fen=', async ({ page }) => {
  // A simple K+P vs K position, White to move.
  const fen = '8/8/8/8/8/5k2/4P3/5K2 w - - 0 1';
  await page.goto(`/#/analysis?fen=${encodeURIComponent(fen)}`);
  await expect(page.locator('.sq[data-square="e2"] .pc')).toBeVisible(); // the pawn is on e2
});
