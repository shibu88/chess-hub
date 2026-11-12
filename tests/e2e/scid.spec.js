import { test, expect } from '@playwright/test';
import { zipSync } from 'fflate';
import { buildDatabase, sampleGames, encodeGameRecord } from '../../scripts/make-scid-fixture.mjs';

test.use({ viewport: { width: 500, height: 900 } });

// Build a real Scid database in memory and return the three files setInputFiles wants.
function scidFiles(base, version, games = sampleGames()) {
  const db = buildDatabase(games, version);
  const ext = version === 5 ? ['si5', 'sn5', 'sg5'] : ['si4', 'sn4', 'sg4'];
  const mk = (e, bytes) => ({ name: `${base}.${e}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  return { files: [mk(ext[0], db.si), mk(ext[1], db.sn), mk(ext[2], db.sg)], db };
}

async function gotoUpload(page) {
  await page.goto('/#/analysis');
  await page.click('.subtab:has-text("Upload")');
}

test('Scid 4: a complete set is read into a searchable game list', async ({ page }) => {
  await gotoUpload(page);
  const { files } = scidFiles('mydb', 4);
  await page.setInputFiles('.upload input[type="file"]', files);

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
  await expect(page.locator('.game-row').first()).toContainText('Carlsen, Magnus');
  await expect(page.locator('.game-row').first()).toContainText('5 moves'); // 10 plies → 5 full moves, from the index
});

test('Scid 5: open a game → Review, then back to the intact list', async ({ page }) => {
  await gotoUpload(page);
  const { files } = scidFiles('mydb', 5);
  await page.setInputFiles('.upload input[type="file"]', files);

  await expect(page.locator('.list-count')).toContainText('2 games');
  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });

  await page.click('.review-head >> text=← Board');
  await expect(page.locator('.list-count')).toContainText('2 games');
});

test('Scid: opening a chess-variant game shows a note instead of Review', async ({ page }) => {
  await gotoUpload(page);
  const games = [{
    headers: { White: 'Variant', Black: 'Player', Result: '*', Event: 'E', Site: 'S', Round: '1' },
    record: encodeGameRecord({ moves: ['e4', 'e5'] }),
    variant: true,
  }];
  const { files } = scidFiles('var', 5, games);
  await page.setInputFiles('.upload input[type="file"]', files);

  await page.click('.game-row:has-text("Variant")');
  await expect(page.locator('.upload-msg')).toContainText('chess variant');
  await expect(page.locator('.summary-card')).toHaveCount(0);
});

test('Scid 4: a set packed inside one .zip is read and a game opens into Review', async ({ page }) => {
  await gotoUpload(page);
  const db = buildDatabase(sampleGames(), 4);
  const zipped = zipSync({ 'mydb.si4': db.si, 'mydb.sn4': db.sn, 'mydb.sg4': db.sg });
  await page.setInputFiles('.upload input[type="file"]', [{ name: 'mydb.zip', mimeType: 'application/zip', buffer: Buffer.from(zipped) }]);

  await expect(page.locator('.game-list')).toBeVisible();
  await expect(page.locator('.list-count')).toContainText('2 games');
  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.summary-card')).toBeVisible({ timeout: 60000 });
});

test('Scid: a UTF-8 player name is listed correctly', async ({ page }) => {
  await gotoUpload(page);
  const games = [{
    headers: { White: 'Réti, Richárd', Black: 'Nimzowitsch, Aron', Result: '1-0', Event: 'E', Site: 'S', Round: '1' },
    record: encodeGameRecord({ moves: ['Nf3', 'd5'] }),
  }];
  const { files } = scidFiles('utf', 5, games);
  await page.setInputFiles('.upload input[type="file"]', files);

  await expect(page.locator('.game-row').first()).toContainText('Réti, Richárd');
  await expect(page.locator('.game-row').first()).toContainText('Nimzowitsch, Aron');
});

test('Scid: opening a damaged game shows a note instead of Review', async ({ page }) => {
  await gotoUpload(page);
  const { files, db } = scidFiles('bad', 5);
  // Corrupt the first game's first move byte (byte 0 = end-tags, byte 1 = flags,
  // byte 2 = first move) → an illegal move → decodeGame returns { skipped:'damaged' }.
  db.sg[2] = 0x80;
  files[2].buffer = Buffer.from(db.sg);
  await page.setInputFiles('.upload input[type="file"]', files);

  await page.click('.game-row:has-text("Carlsen, Magnus")');
  await expect(page.locator('.upload-msg')).toContainText('skipped');
  await expect(page.locator('.summary-card')).toHaveCount(0);
});
