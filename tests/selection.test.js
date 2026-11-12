import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesThemes, filterByThemes, pickSet, mulberry32, themesOf,
  solverColor, pickVaried, buildVariedSet,
} from '../src/training/selection.js';

// A puzzle whose solver plays `color`: the FEN's side-to-move is the opposite.
function puz(id, solver) {
  const stm = solver === 'w' ? 'b' : 'w';
  return { id, fen: `8/8/8/8/8/8/8/K6k ${stm} - - 0 1`, themes: 'mate' };
}
const longestRun = (seq) => {
  let max = 1, cur = 1;
  for (let i = 1; i < seq.length; i += 1) { if (seq[i] === seq[i - 1]) { cur += 1; max = Math.max(max, cur); } else cur = 1; }
  return seq.length ? max : 0;
};

function pool(n, themeFor = () => 'fork') {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, themes: themeFor(i) }));
}

test('themesOf splits the space-joined string', () => {
  assert.deepEqual(themesOf({ themes: 'fork pin endgame' }), ['fork', 'pin', 'endgame']);
  assert.deepEqual(themesOf({ themes: [] }), []);
});

test('matchesThemes is OR, and empty tokens match everything', () => {
  const p = { themes: 'fork short middlegame' };
  assert.equal(matchesThemes(p, []), true);
  assert.equal(matchesThemes(p, ['fork']), true);
  assert.equal(matchesThemes(p, ['pin', 'fork']), true);
  assert.equal(matchesThemes(p, ['pin']), false);
});

test('filterByThemes keeps only matching puzzles', () => {
  const p = [
    { id: 'a', themes: 'fork' }, { id: 'b', themes: 'pin' }, { id: 'c', themes: 'fork endgame' },
  ];
  assert.deepEqual(filterByThemes(p, ['fork']).map((x) => x.id), ['a', 'c']);
  assert.equal(filterByThemes(p, []).length, 3);
});

test('pickSet is deterministic for a seed and returns distinct puzzles', () => {
  const p = pool(50);
  const a = pickSet(p, { count: 10, rng: mulberry32(1) });
  const b = pickSet(p, { count: 10, rng: mulberry32(1) });
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.equal(a.length, 10);
  assert.equal(new Set(a.map((x) => x.id)).size, 10); // no duplicates within a set
});

test('pickSet avoids recently-seen puzzles when it can', () => {
  const p = pool(50);
  const seen = new Set(Array.from({ length: 30 }, (_, i) => 'p' + i)); // p0..p29 seen
  const got = pickSet(p, { count: 10, exclude: seen, rng: mulberry32(2) });
  assert.equal(got.length, 10);
  assert.ok(got.every((x) => !seen.has(x.id)), 'none of the picked are in the seen set');
});

test('pickSet falls back to the full pool when avoiding seen leaves too few', () => {
  const p = pool(12);
  const seen = new Set(p.slice(0, 8).map((x) => x.id)); // only 4 fresh, need 10
  const got = pickSet(p, { count: 10, exclude: seen, rng: mulberry32(3) });
  assert.equal(got.length, 10);                 // filled from the whole pool
  assert.equal(new Set(got.map((x) => x.id)).size, 10); // still distinct
});

test('solverColor is the opposite of the FEN side-to-move', () => {
  assert.equal(solverColor(puz('a', 'w')), 'w'); // fen stm = b
  assert.equal(solverColor(puz('b', 'b')), 'b'); // fen stm = w
});

test('pickVaried breaks a same-colour run when the other colour is available', () => {
  // Pool has both colours; after two whites in a row it must serve a black-solver.
  const p = [];
  for (let i = 0; i < 10; i += 1) p.push(puz('w' + i, 'w'));
  for (let i = 0; i < 10; i += 1) p.push(puz('b' + i, 'b'));
  const pick = pickVaried(p, { recent: ['w', 'w'], rng: mulberry32(1) });
  assert.equal(solverColor(pick), 'b');
  // but with no run, it may pick either (just returns something valid)
  assert.ok(pickVaried(p, { recent: ['w'], rng: mulberry32(2) }));
});

test('buildVariedSet avoids three in a row of the same solver colour', () => {
  // Heavily imbalanced pool (mostly white-solver) — the naive shuffle would clump.
  const p = [];
  for (let i = 0; i < 40; i += 1) p.push(puz('w' + i, 'w'));
  for (let i = 0; i < 12; i += 1) p.push(puz('b' + i, 'b'));
  for (const seed of [1, 7, 42, 99, 123]) {
    const set = buildVariedSet(p, { count: 12, rng: mulberry32(seed) });
    assert.equal(set.length, 12);
    assert.equal(new Set(set.map((x) => x.id)).size, 12);     // distinct
    const seq = set.map(solverColor).join('');
    assert.ok(longestRun(seq) <= 2, `run too long for seed ${seed}: ${seq}`);
  }
});

test('buildVariedSet still fills the set when only one colour exists', () => {
  const p = [];
  for (let i = 0; i < 20; i += 1) p.push(puz('w' + i, 'w')); // all white-solver
  const set = buildVariedSet(p, { count: 10, rng: mulberry32(5) });
  assert.equal(set.length, 10);
  assert.equal(new Set(set.map((x) => x.id)).size, 10);
});
