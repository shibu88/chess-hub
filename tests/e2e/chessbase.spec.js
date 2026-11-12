import { test, expect } from '@playwright/test';
import { zipSync } from 'fflate';
import { buildDatabase, sampleGames, encodeGameRecord } from '../../scripts/make-cbh-fixture.mjs';

test.use({ viewport: { width: 500, height: 900 } });

// Build a real ChessBase database in memory and return the four files setInputFiles wants.
function cbFiles(base, games = sampleGames()) {
  const db = buildDatabase(games);
  const mk = (ext, bytes) => ({ name: `${base}.${ext}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  return { files: [mk('cbh', db.cbh), mk('cbg', db.cbg), mk('cbp', db.cbp), mk('cbt', db.cbt)], db };
}

async function gotoUpload(page) {
  await page.goto('/#/analysis');
  await page.click('.subtab:has-text("Upload")');
}

test('ChessBase: a complete set is read into a searchable game list', async ({ page }) => {
  await gotoUpload(page);
  const { files } = cbFiles('mydb');
  await page.setInputFiles('.upload input[type="file"]', files);

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
  await expect(page.locator('.game-row').first()).toContainText('Carlsen, Magnus');
});

test('ChessBase: open a game → Review, then back to the intact list', async ({ page }) => {
  await gotoUpload(page);
  const { files } = cbFiles('mydb');
  await page.setInputFiles('.upload input[type="file"]', files);

  await expect(page.locator('.list-count')).toContainText('2 games');
  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });

  await page.click('.review-head >> text=← Board');
  await expect(page.locator('.list-count')).toContainText('2 games');
});

test('ChessBase: a set packed inside one .zip is read and a game opens into Review', async ({ page }) => {
  await gotoUpload(page);
  const db = buildDatabase(sampleGames());
  const zipped = zipSync({ 'mydb.cbh': db.cbh, 'mydb.cbg': db.cbg, 'mydb.cbp': db.cbp, 'mydb.cbt': db.cbt });
  await page.setInputFiles('.upload input[type="file"]', [{ name: 'mydb.zip', mimeType: 'application/zip', buffer: Buffer.from(zipped) }]);

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });
});

test('ChessBase: a large set streams into the list without freezing', async ({ page }) => {
  await gotoUpload(page);
  // 5200 games crosses the worker's 5000-row batch boundary → exercises streaming.
  const games = [];
  for (let i = 0; i < 5200; i += 1) {
    games.push({ headers: { White: `White ${i}`, Black: `Black ${i}`, Result: '1-0', Event: 'Scale', Site: 'X', Round: '1' }, record: encodeGameRecord({ moves: ['e4', 'e5'] }) });
  }
  const db = buildDatabase(games);
  const mk = (ext, bytes) => ({ name: `big.${ext}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await page.setInputFiles('.upload input[type="file"]', [mk('cbh', db.cbh), mk('cbg', db.cbg), mk('cbp', db.cbp), mk('cbt', db.cbt)]);

  await expect(page.locator('.list-count')).toContainText('5200 games', { timeout: 30000 });
  await expect(page.locator('.game-row')).toHaveCount(50); // one page
});

test('ChessBase: opening a damaged game shows a note instead of Review', async ({ page }) => {
  await gotoUpload(page);
  const { files, db } = cbFiles('bad');
  // The first game starts at .cbg offset 0; its moves begin at byte 4 (after the
  // 4-byte header). A rook token there is illegal from the start → decode skips it.
  db.cbg[4] = 0x4e;
  files[1].buffer = Buffer.from(db.cbg); // files[1] is the .cbg
  await page.setInputFiles('.upload input[type="file"]', files);

  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.upload-msg')).toContainText('skipped');
  await expect(page.locator('.summary-card')).toHaveCount(0);
});
