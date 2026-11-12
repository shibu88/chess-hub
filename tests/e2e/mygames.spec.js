import { test, expect } from '@playwright/test';

// Small viewport → Review runs at Fast (150k nodes).
test.use({ viewport: { width: 500, height: 900 } });

const sq = (page, s) => page.click(`.sq[data-square="${s}"]`);

test('Board → Review → Save → My games (download, rename, delete)', async ({ page }) => {
  await page.goto('/#/analysis');

  // Fool's mate, then analyse and save.
  await sq(page, 'f2'); await sq(page, 'f3');
  await sq(page, 'e7'); await sq(page, 'e5');
  await sq(page, 'g2'); await sq(page, 'g4');
  await sq(page, 'd8'); await sq(page, 'h4');
  await page.click('.analyze-btn');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });

  await page.click('.review-actions >> text=Save');
  await expect(page.locator('.save-status')).toHaveText('Saved ✓');

  // It shows up in My games.
  await page.click('.subtab:has-text("My games")');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-badge')).toHaveText('Board');

  // Download PGN triggers a .pgn file.
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.mg-act:has-text("PGN")'),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.pgn$/);

  // Rename.
  await page.click('.mg-act:has-text("Rename")');
  await page.fill('.mg-rename .am-input', 'My best game');
  await page.click('.mg-rename >> text=Save');
  await expect(page.locator('.mg-title')).toHaveText('My best game');

  // Delete (asks first).
  await page.click('.mg-act.danger');
  await page.click('.confirm-dialog button:has-text("Delete")');
  await expect(page.locator('.mg-item')).toHaveCount(0);
  await expect(page.locator('.mg-list')).toContainText('No saved games');
});

test('Play game-over → Analyze opens the Review', async ({ page }) => {
  await page.goto('/#/play');
  // Beginner is fastest.
  await page.selectOption('#difficulty', 'beginner');
  await page.click('button:has-text("New Game")');

  // Make a move and wait for the engine reply, then resign to end the game.
  await page.waitForSelector('.status:has-text("Your move")', { timeout: 25000 });
  await sq(page, 'e2'); await sq(page, 'e4');
  await expect(page.locator('.history li')).toHaveCount(1, { timeout: 25000 });

  await page.click('button:has-text("Resign")');
  await page.click('button:has-text("Yes, resign")');
  await expect(page.locator('.gameover-actions')).toBeVisible();

  await page.click('.gameover-actions >> text=Analyze');
  await expect(page.locator('.review-layout')).toBeVisible();
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });
});
