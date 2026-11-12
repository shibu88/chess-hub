// Unit tests for the pure review maths (src/analysis/review.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCp, scoreToCp, winPercent, winPercentFromScore,
  moveAccuracy, lossOf, gameAccuracyByColor, classify,
} from '../src/analysis/review.js';

const approx = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('clampCp clamps to ±1000', () => {
  assert.equal(clampCp(50), 50);
  assert.equal(clampCp(5000), 1000);
  assert.equal(clampCp(-5000), -1000);
});

test('scoreToCp: cp is clamped, mate counts as ±1000, missing is 0', () => {
  assert.equal(scoreToCp({ type: 'cp', value: 123 }), 123);
  assert.equal(scoreToCp({ type: 'cp', value: 3000 }), 1000);
  assert.equal(scoreToCp({ type: 'mate', value: 3 }), 1000);
  assert.equal(scoreToCp({ type: 'mate', value: -2 }), -1000);
  assert.equal(scoreToCp(null), 0);
});

test('winPercent: 0 cp is 50%, symmetric, known values', () => {
  approx(winPercent(0), 50);
  approx(winPercent(100) + winPercent(-100), 100); // symmetry about 50
  approx(winPercent(100), 59.1026, 1e-3);
  // A clamped mate (±1000) is ~97.56% / ~2.44%, NOT 100% (Lichess caps at 1000cp).
  approx(winPercent(1000), 97.5447, 1e-3);
  approx(winPercentFromScore({ type: 'mate', value: 1 }), 97.5447, 1e-3);
});

test('moveAccuracy: no loss ≈ 100, big loss → near 0, clamped', () => {
  approx(moveAccuracy(60, 60), 100, 1e-3); // 103.1668*1 - 3.1669 ≈ 99.9999
  assert.ok(moveAccuracy(90, 10) < 10);
  assert.ok(moveAccuracy(50, 50) <= 100 && moveAccuracy(0, 100) >= 0);
});

test('lossOf never goes below 0', () => {
  assert.equal(lossOf(70, 55), 15);
  assert.equal(lossOf(40, 60), 0);
});

// --- Labels ------------------------------------------------------------------

const base = { playedUci: 'a2a3', bestUci: 'e2e4', winBefore: 55, winAfter: 55 };

test('label: Best when the played move is the engine top move', () => {
  assert.equal(classify({ ...base, playedUci: 'e2e4', bestUci: 'e2e4', winAfter: 50 }), 'Best');
});

test('label: Best when loss is 0 even if not flagged top', () => {
  assert.equal(classify({ ...base, winBefore: 55, winAfter: 55 }), 'Best');
});

test('label: loss bands Excellent/Good/Inaccuracy/Mistake/Blunder', () => {
  assert.equal(classify({ ...base, winBefore: 60, winAfter: 58.5 }), 'Excellent'); // loss 1.5
  assert.equal(classify({ ...base, winBefore: 60, winAfter: 56 }), 'Good');        // loss 4
  assert.equal(classify({ ...base, winBefore: 60, winAfter: 52 }), 'Inaccuracy');  // loss 8
  assert.equal(classify({ ...base, winBefore: 60, winAfter: 45 }), 'Mistake');     // loss 15
  assert.equal(classify({ ...base, winBefore: 60, winAfter: 25 }), 'Blunder');     // loss 35
});

test('label: a forced (only legal) move is never an error', () => {
  assert.equal(classify({ ...base, onlyLegalMove: true, winBefore: 60, winAfter: 20 }), 'Best');
});

test('label: Book takes precedence', () => {
  assert.equal(classify({ ...base, isBook: true, winBefore: 60, winAfter: 20 }), 'Book');
});

test('label: Great = top move and the 2nd line ≥10 Win% worse', () => {
  assert.equal(classify({
    ...base, playedUci: 'e2e4', bestUci: 'e2e4',
    winBefore: 70, winAfter: 69, secondWinAfter: 55, // gap 15
  }), 'Great');
  // gap under 10 → just Best
  assert.equal(classify({
    ...base, playedUci: 'e2e4', bestUci: 'e2e4',
    winBefore: 70, winAfter: 69, secondWinAfter: 64, // gap 6
  }), 'Best');
});

test('label: Brilliant = a best/great sacrifice, winAfter≥50 and winBefore<90', () => {
  assert.equal(classify({
    ...base, playedUci: 'e2e4', bestUci: 'e2e4',
    winBefore: 85, winAfter: 60, isSacrifice: true,
  }), 'Brilliant');
  // same but winBefore too high (already winning) → not Brilliant
  assert.equal(classify({
    ...base, playedUci: 'e2e4', bestUci: 'e2e4',
    winBefore: 95, winAfter: 60, isSacrifice: true,
  }), 'Best');
  // sacrifice but losing after → not Brilliant
  assert.equal(classify({
    ...base, playedUci: 'e2e4', bestUci: 'e2e4',
    winBefore: 85, winAfter: 40, isSacrifice: true,
  }), 'Best');
});

test('label: Miss when opponent just blundered and this move loses ≥10', () => {
  assert.equal(classify({
    ...base, winBefore: 70, winAfter: 55, prevOpponentLabel: 'Blunder', // loss 15
  }), 'Miss');
  // small loss after an opponent blunder is not a Miss
  assert.equal(classify({
    ...base, winBefore: 60, winAfter: 57, prevOpponentLabel: 'Blunder', // loss 3
  }), 'Good');
});

// --- Game accuracy -----------------------------------------------------------

test('gameAccuracy: a flawless game scores ~100 for both sides', () => {
  const wp = [50, 50, 50, 50, 50, 50, 50, 50, 50];
  const { white, black } = gameAccuracyByColor(wp, 'w');
  approx(white, 100, 0.5);
  approx(black, 100, 0.5);
});

test('gameAccuracy: White blunders drop only White; Black plays on', () => {
  // White (moves at even indices) throws the game away; Black's replies are fine.
  // White-view drops on White's own moves (0→1, 2→3, 4→5) = White blunders.
  const wp = [50, 20, 22, 8, 10, 3];
  const res = gameAccuracyByColor(wp, 'w');
  assert.ok(res.white < res.black, `white ${res.white} < black ${res.black}`);
  assert.ok(res.white >= 0 && res.white <= 100);
  assert.ok(res.black >= 0 && res.black <= 100);
});

test('gameAccuracy: respects startColor (Black to move first)', () => {
  // Black to move first; Black is the one tanking the eval here.
  const wp = [50, 80, 80, 90, 90]; // white-view rising = good for White = bad for Black moves
  const res = gameAccuracyByColor(wp, 'b');
  assert.ok(res.black < res.white, `black ${res.black} < white ${res.white}`);
});

test('gameAccuracy: fewer than 2 positions → nulls', () => {
  assert.deepEqual(gameAccuracyByColor([50], 'w'), { white: null, black: null });
});
