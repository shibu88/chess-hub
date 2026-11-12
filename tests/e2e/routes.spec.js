import { test, expect } from '@playwright/test';

test('home shows the title and three section cards', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('.home-title')).toHaveText('Chess Hub');
  await expect(page.locator('.card-title')).toHaveCount(3);
});

test('Analysis shows its three sub-tabs with a board', async ({ page }) => {
  await page.goto('/#/analysis');
  await expect(page.locator('.subtab')).toHaveCount(3);
  await expect(page.locator('.board')).toBeVisible();
});

test('Training shows the path card and the levels grid', async ({ page }) => {
  await page.goto('/#/training');
  await expect(page.locator('.train-card')).toHaveCount(2);
  await expect(page.locator('.level-card')).toHaveCount(12);
});

test('About and Play routes resolve', async ({ page }) => {
  await page.goto('/#/about');
  await expect(page.locator('h1')).toHaveText('About Chess Hub');
  await page.goto('/#/play');
  await expect(page.locator('#play-h')).toHaveText('Play vs Stockfish');
});

test('the Login button opens a Login/Register tabbed dialog', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#account-area')).toContainText('Login');
  await page.click('#account-area >> text=Login');
  await expect(page.locator('.auth-dialog')).toBeVisible();
  await expect(page.locator('.auth-tab')).toHaveCount(2);
  await page.click('.auth-tab >> text=Register');
  await expect(page.locator('#reg-name')).toBeVisible(); // Display name field
});
