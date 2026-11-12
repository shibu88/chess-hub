import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

test.use({ viewport: { width: 500, height: 900 } });

const PGN = `[Event "Club"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[Event "Online"]
[White "Carol"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 2. c4 e5 0-1
`;

test('Upload: paste PGN → searchable list → open a game in Review', async ({ page }) => {
  await page.goto('/#/analysis');
  await page.click('.subtab:has-text("Upload")');

  await page.click('.paste-fold summary');
  await page.fill('.paste-area', PGN);
  await page.click('text=Parse pasted PGN');

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
  await expect(page.locator('.game-row')).toHaveCount(2);

  // Search narrows the list.
  await page.fill('.am-input[type="search"]', 'Carol');
  await expect(page.locator('.game-row')).toHaveCount(1);
  await expect(page.locator('.game-row')).toContainText('Carol – Dave');

  // Clear search, open the first game → Review runs.
  await page.fill('.am-input[type="search"]', '');
  await page.click('.game-row:has-text("Alice")');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });

  // Back returns to the parsed list.
  await page.click('.review-head >> text=← Board');
  await expect(page.locator('.list-count')).toContainText('2 games');
});

test('Upload: a ZIP containing a PGN is read', async ({ page }) => {
  await page.goto('/#/analysis');
  await page.click('.subtab:has-text("Upload")');

  const zip = zipSync({ 'games.pgn': strToU8(PGN) });
  await page.setInputFiles('.upload input[type="file"]', [
    { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
  ]);

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
});

test('Upload: an incomplete Scid set is detected and names the missing file', async ({ page }) => {
  await page.goto('/#/analysis');
  await page.click('.subtab:has-text("Upload")');

  await page.setInputFiles('.upload input[type="file"]', [
    { name: 'mydb.si4', mimeType: 'application/octet-stream', buffer: Buffer.from('') },
    { name: 'mydb.sg4', mimeType: 'application/octet-stream', buffer: Buffer.from('') },
  ]);

  await expect(page.locator('.upload-msg.incomplete')).toContainText('mydb.sn4');
  await expect(page.locator('.upload-msg.incomplete')).toContainText('incomplete');
});
