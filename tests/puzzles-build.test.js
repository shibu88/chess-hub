import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelOf, bestTier, headerIndex, parseRow, toRecord, mulberry32, pickSpread,
  primaryTheme, topThemes, createCollector, LEVEL_BANDS,
} from '../scripts/puzzles-build-lib.mjs';

const HEADER = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate';

test('levelOf maps ratings to the CLAUDE.md bands, including edges', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(799), 0);
  assert.equal(levelOf(800), 1);
  assert.equal(levelOf(999), 1);
  assert.equal(levelOf(1000), 2);
  assert.equal(levelOf(1999), 6);
  assert.equal(levelOf(2000), 7);
  assert.equal(levelOf(2799), 10);
  assert.equal(levelOf(2800), 11);
  assert.equal(levelOf(3200), 11);
  // every band's own min/max land on its level
  for (const b of LEVEL_BANDS) {
    assert.equal(levelOf(b.min), b.level);
    if (b.max != null) assert.equal(levelOf(b.max), b.level);
  }
});

test('bestTier returns the strictest tier a row passes', () => {
  assert.equal(bestTier({ popularity: 90, nbPlays: 400, ratingDeviation: 80 }), 0);
  assert.equal(bestTier({ popularity: 80, nbPlays: 200, ratingDeviation: 95 }), 1);
  assert.equal(bestTier({ popularity: 65, nbPlays: 60, ratingDeviation: 110 }), 2);
  assert.equal(bestTier({ popularity: 10, nbPlays: 1, ratingDeviation: 300 }), 3); // band only
});

test('headerIndex reads columns by name and rejects a bad header', () => {
  const idx = headerIndex('﻿' + HEADER); // tolerate a BOM
  assert.equal(idx.FEN, 1);
  assert.equal(idx.Themes, 7);
  assert.throws(() => headerIndex('a,b,c'), /missing/);
});

test('parseRow types the fields and drops malformed lines', () => {
  const idx = headerIndex(HEADER);
  const row = parseRow('00008,8/8/8/8/8/8/8/K6k b - - 0 1,f2g3 e6e7,1819,77,95,10446,crushing hangingPiece,url,,', idx);
  assert.equal(row.id, '00008');
  assert.equal(row.rating, 1819);
  assert.equal(row.popularity, 95);
  assert.equal(row.nbPlays, 10446);
  assert.equal(row.themes, 'crushing hangingPiece');
  assert.equal(parseRow('too,few,fields', idx), null);
  assert.equal(parseRow(',,,,,,,', idx), null); // empty id/fen/moves
});

test('toRecord keeps a compact shape with space-joined strings', () => {
  const rec = toRecord({ id: 'x', fen: 'F', moves: 'a1a2 b1b2', rating: 1500, themes: 'fork pin', extra: 1 });
  assert.deepEqual(rec, { id: 'x', fen: 'F', moves: 'a1a2 b1b2', rating: 1500, themes: 'fork pin' });
});

test('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('primaryTheme is the first theme token', () => {
  assert.equal(primaryTheme({ themes: 'fork short middlegame' }), 'fork');
  assert.equal(primaryTheme({ themes: '' }), 'other');
});

test('pickSpread is deterministic and spreads across themes', () => {
  // 100 "mate" + 10 "fork" + 5 "pin"; asking for 30 should pull in the rarer
  // themes, not just mates.
  const rows = [];
  for (let i = 0; i < 100; i += 1) rows.push({ id: 'm' + i, themes: 'mate' });
  for (let i = 0; i < 10; i += 1) rows.push({ id: 'f' + i, themes: 'fork' });
  for (let i = 0; i < 5; i += 1) rows.push({ id: 'p' + i, themes: 'pin' });

  const pick1 = pickSpread(rows, 30, mulberry32(7));
  const pick2 = pickSpread(rows, 30, mulberry32(7));
  assert.deepEqual(pick1.map((r) => r.id), pick2.map((r) => r.id)); // deterministic
  assert.equal(pick1.length, 30);
  const themes = new Set(pick1.map((r) => r.themes));
  assert.ok(themes.has('fork') && themes.has('pin'), 'rarer themes are represented');
  // round-robin means forks/pins aren't starved: at least several of each
  assert.ok(pick1.filter((r) => r.themes === 'fork').length >= 5);

  // asking for more than available returns everything (shuffled)
  const all = pickSpread(rows.slice(0, 20), 50, mulberry32(1));
  assert.equal(all.length, 20);
});

test('topThemes ranks the most common tokens', () => {
  const rows = [
    { themes: 'fork short' }, { themes: 'fork pin' }, { themes: 'pin endgame' }, { themes: 'mate mateIn1' },
  ];
  const top = topThemes(rows, 3);
  assert.equal(top[0], 'fork'); // appears twice
  assert.ok(top.includes('pin'));
});

test('collector buckets by level and relaxes only when a level is short', () => {
  const collector = createCollector({ perLevel: 10, seed: 5, reservoir: 1000 });
  // Level 2 (rating 1000–1199): 20 tier-0 puzzles → no relaxation needed.
  for (let i = 0; i < 20; i += 1) {
    collector.add({ id: 'a' + i, fen: 'F', moves: 'e2e4', rating: 1100, themes: 'fork', popularity: 95, nbPlays: 500, ratingDeviation: 70 });
  }
  // Level 3 (1200–1399): only 3 tier-0, plus 20 weak (tier-3) → must relax to fill 10.
  for (let i = 0; i < 3; i += 1) {
    collector.add({ id: 'g' + i, fen: 'F', moves: 'e2e4', rating: 1300, themes: 'pin', popularity: 95, nbPlays: 500, ratingDeviation: 70 });
  }
  for (let i = 0; i < 20; i += 1) {
    collector.add({ id: 'w' + i, fen: 'F', moves: 'e2e4', rating: 1300, themes: 'pin', popularity: 10, nbPlays: 1, ratingDeviation: 300 });
  }

  const { levels, seen } = collector.finalize();
  assert.equal(seen, 43);
  const lv2 = levels[2];
  assert.equal(lv2.tier, 0, 'level 2 stays at the strictest tier');
  assert.equal(lv2.rows.length, 10);
  const lv3 = levels[3];
  assert.equal(lv3.tier, 3, 'level 3 relaxed to the band-only tier');
  assert.equal(lv3.rows.length, 10);
  // empty level
  assert.equal(levels[11].rows.length, 0);
});

test('collector output is deterministic for a seed', () => {
  function run() {
    const c = createCollector({ perLevel: 5, seed: 99, reservoir: 1000 });
    for (let i = 0; i < 40; i += 1) {
      c.add({ id: 'p' + i, fen: 'F', moves: 'e2e4', rating: 1500, themes: i % 2 ? 'fork' : 'pin', popularity: 95, nbPlays: 500, ratingDeviation: 70 });
    }
    return c.finalize().levels[4].rows.map((r) => r.id);
  }
  assert.deepEqual(run(), run());
});
