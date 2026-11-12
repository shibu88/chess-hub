import { test, expect } from '@playwright/test';

// Small viewport → Review defaults to Fast (150k nodes), keeping this quick.
test.use({ viewport: { width: 500, height: 900 } });

const sq = (page, s) => page.click(`.sq[data-square="${s}"]`);

test('ANALYZE runs a full review and shows the results', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.locator('.board')).toBeVisible();

  // Fool's mate: 1. f3 e5 2. g4 Qh4#
  await sq(page, 'f2'); await sq(page, 'f3');
  await sq(page, 'e7'); await sq(page, 'e5');
  await sq(page, 'g2'); await sq(page, 'g4');
  await sq(page, 'd8'); await sq(page, 'h4');

  await page.click('.analyze-btn');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });

  // The progress panel is gone, the pieces of the review are present.
  await expect(page.locator('.review-progress')).toBeHidden();
  await expect(page.locator('.acc-val')).toHaveCount(2);         // White + Black accuracy
  await expect(page.locator('.eval-graph .graph-svg')).toBeVisible();
  await expect(page.locator('.mv-dot[data-label="Blunder"]').first()).toBeVisible();

  // The colour legend explains each label.
  await page.click('.legend > summary');
  await expect(page.locator('.legend-list')).toContainText('Blunder');
  await expect(page.locator('.legend-list')).toContainText('a serious error');

  // Selecting a move shows its detail.
  await page.click('.review-moves .mv:has-text("g4")');
  await expect(page.locator('.move-detail')).toContainText('played');

  // Keyboard navigation works.
  await page.keyboard.press('Home');
  await expect(page.locator('.review-moves .mv.current')).toHaveText(/f3/);

  // Back to the board keeps the game.
  await page.click('.review-head >> text=← Board');
  await expect(page.locator('.am-moves')).toContainText('Qh4#');
});
