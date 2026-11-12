import { test, expect } from '@playwright/test';

// Deterministic puzzle data so the run doesn't depend on the 295 MB build. Every
// puzzle is the same mate-in-one (distinct ids): the FEN is before the opponent's
// knight move (a6b4), then the solver mates with Ra8# (a1a8).
const FEN = '6k1/5ppp/n7/8/8/8/8/R5K1 b - - 0 1';
const MOVES = 'a6b4 a1a8';
const PUZZLES = Array.from({ length: 10 }, (_, i) => ({
  id: 't' + i, fen: FEN, moves: MOVES, rating: 500, themes: 'mate mateIn1 backRankMate short oneMove',
}));
// A Black-to-solve puzzle (opponent White is to move in the FEN), so the solver
// must pick up black pieces — the regression guard for the playerColor bug.
const BLACK_FEN = 'r5k1/8/8/8/8/N7/5PPP/6K1 w - - 0 1';
const BLACK_MOVES = 'a3b5 a8a1'; // opponent Nb5, then Black mates with Ra1#
const BLACK_PUZZLES = Array.from({ length: 4 }, (_, i) => ({
  id: 'b' + i, fen: BLACK_FEN, moves: BLACK_MOVES, rating: 850, themes: 'mate mateIn1 backRankMate',
}));

const INDEX = Array.from({ length: 12 }, (_, lvl) => ({
  level: lvl, min: lvl === 0 ? 0 : lvl * 200 + 600, max: lvl === 11 ? null : lvl * 200 + 799,
  count: lvl <= 1 ? 10 : 0, topThemes: lvl === 0 ? ['mateIn1', 'backRankMate'] : [],
}));

async function mockPuzzles(page) {
  await page.route('**/puzzles/level-*.json', (route) => route.fulfill({ json: [] }));           // catch-all
  await page.route('**/puzzles/level-0.json', (route) => route.fulfill({ json: PUZZLES }));       // white solver
  await page.route('**/puzzles/level-1.json', (route) => route.fulfill({ json: BLACK_PUZZLES }));  // black solver
  await page.route('**/puzzles/index.json', (route) => route.fulfill({ json: INDEX }));
}

const sq = (page, s) => page.click(`.sq[data-square="${s}"]`);

test('path: solving a full set (10/10) unlocks the next level and persists', async ({ page }) => {
  await mockPuzzles(page);
  await page.goto('/#/training');

  await page.click('button:has-text("Start training")');
  for (let i = 0; i < 10; i += 1) {
    await expect(page.locator('.puzzle-panel .status')).toContainText('to play', { timeout: 10000 });
    await sq(page, 'a1');
    await sq(page, 'a8');
    await expect(page.locator('.puzzle-result-title')).toContainText('Solved', { timeout: 10000 });
    await page.click('.puzzle-controls button:has-text("Next")');
  }

  await expect(page.locator('.train-summary')).toContainText('unlocked');

  // The unlocked level survives a full reload (guest IndexedDB). Give the
  // immediate save a moment to land before tearing the page down.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.train-stat')).toContainText('Lv 1');
});

test('endless: a wrong move is taken back; a correct move solves', async ({ page }) => {
  await mockPuzzles(page);
  await page.goto('/#/training');

  await page.locator('.level-card').first().click();          // Lv 0
  // The status spells out the objective from the puzzle's themes.
  await expect(page.locator('.puzzle-panel .status')).toContainText('Mate in 1', { timeout: 10000 });

  // Wrong but legal (Ra7): reported, with no result shown and the position intact.
  await sq(page, 'a1');
  await sq(page, 'a7');
  await expect(page.locator('.puzzle-panel .status')).toContainText('Not the move');
  await expect(page.locator('.puzzle-result')).toBeHidden();

  // Correct (Ra8#): solves.
  await sq(page, 'a1');
  await sq(page, 'a8');
  await expect(page.locator('.puzzle-result-title')).toContainText('Solved');
});

test('endless: Skip goes to a new puzzle without counting it', async ({ page }) => {
  await mockPuzzles(page);
  await page.goto('/#/training');

  await page.locator('.level-card').first().click();          // Lv 0
  await expect(page.locator('.puzzle-panel .status')).toContainText('Mate in 1', { timeout: 10000 });
  await expect(page.locator('.train-solved')).toContainText('0 solved');

  // Skip: a fresh puzzle, still nothing solved, and Next is not offered yet.
  await page.click('.puzzle-controls button:has-text("Skip")');
  await expect(page.locator('.puzzle-panel .status')).toContainText('to play', { timeout: 10000 });
  await expect(page.locator('.train-solved')).toContainText('0 solved');
  await expect(page.locator('.puzzle-result')).toBeHidden();
});

test('endless: a Black-to-solve puzzle lets you move the black pieces', async ({ page }) => {
  await mockPuzzles(page);
  await page.goto('/#/training');

  await page.locator('.level-card').nth(1).click();           // Lv 1 (black solver)
  await expect(page.locator('.puzzle-panel .status')).toContainText('Black to play', { timeout: 10000 });

  // Black rook a8 → a1 is mate; this only works if black pieces are pickable.
  await sq(page, 'a8');
  await sq(page, 'a1');
  await expect(page.locator('.puzzle-result-title')).toContainText('Solved');
});
