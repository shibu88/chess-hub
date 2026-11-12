import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultProgress, normalize, recordAttempt, solvedCount, startSet, recordSetOutcome,
  isSetComplete, didPassSet, completeSet, mergeProgress, pushSeen,
  SET_SIZE, SOLVED_CAP, SEEN_CAP,
} from '../src/training/progress.js';

test('normalize fills a valid shape from partial/empty input', () => {
  const p = normalize({ pathLevel: 99, solvedIds: 'nope' });
  assert.equal(p.pathLevel, 11);          // clamped to MAX_LEVEL
  assert.deepEqual(p.solvedIds, []);      // bad type → empty
  assert.deepEqual(normalize(null), defaultProgress());
});

test('a set of 10 passes at 8 first-try solves and unlocks the next level', () => {
  const p = defaultProgress();
  startSet(p, 0, Array.from({ length: SET_SIZE }, (_, i) => 'p' + i));
  // 8 first-try, 2 not
  for (let i = 0; i < 8; i += 1) recordSetOutcome(p, true);
  recordSetOutcome(p, false);
  recordSetOutcome(p, false);
  assert.equal(isSetComplete(p), true);
  assert.equal(didPassSet(p), true);
  const out = completeSet(p);
  assert.deepEqual(out, { passed: true, score: 8, level: 0, unlockedLevel: 1 });
  assert.equal(p.pathLevel, 1);
  assert.equal(p.levelsPassed, 1);
  assert.equal(p.set, null);
});

test('a set fails at 7 first-try solves and does not advance', () => {
  const p = defaultProgress();
  startSet(p, 0, Array.from({ length: SET_SIZE }, (_, i) => 'q' + i));
  for (let i = 0; i < 7; i += 1) recordSetOutcome(p, true);
  for (let i = 0; i < 3; i += 1) recordSetOutcome(p, false);
  assert.equal(didPassSet(p), false);
  const out = completeSet(p);
  assert.equal(out.passed, false);
  assert.equal(p.pathLevel, 0);           // still on level 0
});

test('recordAttempt tracks distinct solves per level and caps the lists', () => {
  const p = defaultProgress();
  recordAttempt(p, { level: 3, id: 'a', solved: true });
  recordAttempt(p, { level: 3, id: 'a', solved: true }); // same id again
  recordAttempt(p, { level: 3, id: 'b', solved: false });
  assert.equal(solvedCount(p, 3), 1);     // 'a' counted once; 'b' not solved
  assert.equal(p.stats['3'].attempts, 3);
  assert.ok(p.solvedIds.includes('a'));
  assert.ok(!p.solvedIds.includes('b'));

  // seenIds keeps newest first and is capped
  const q = defaultProgress();
  for (let i = 0; i < SEEN_CAP + 50; i += 1) pushSeen(q, 's' + i);
  assert.equal(q.seenIds.length, SEEN_CAP);
  assert.equal(q.seenIds[0], 's' + (SEEN_CAP + 49)); // most recent at the front

  const r = defaultProgress();
  for (let i = 0; i < SOLVED_CAP + 10; i += 1) recordAttempt(r, { level: 0, id: 'x' + i, solved: true });
  assert.equal(r.solvedIds.length, SOLVED_CAP);
});

test('mergeProgress unions ids, maxes levels, and combines stats', () => {
  const a = defaultProgress();
  a.pathLevel = 2; a.levelsPassed = 2; a.solvedIds = ['a', 'b']; a.seenIds = ['a'];
  a.stats = { '0': { solved: 5, attempts: 6 }, '1': { solved: 3, attempts: 4 } };
  const b = defaultProgress();
  b.pathLevel = 4; b.levelsPassed = 4; b.solvedIds = ['b', 'c']; b.seenIds = ['c'];
  b.stats = { '0': { solved: 2, attempts: 10 }, '2': { solved: 1, attempts: 1 } };

  const m = mergeProgress(a, b);
  assert.equal(m.pathLevel, 4);
  assert.equal(m.levelsPassed, 4);
  assert.deepEqual([...m.solvedIds].sort(), ['a', 'b', 'c']); // union, de-duped
  assert.equal(m.stats['0'].solved, 5);    // max
  assert.equal(m.stats['0'].attempts, 16); // sum
  assert.equal(m.stats['2'].solved, 1);
});
