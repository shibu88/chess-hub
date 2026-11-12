// Unit tests for the opening lookup (src/analysis/openings.js). Uses an
// in-memory map keyed by real chess.js EPDs, so no generated file is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tryMove } from '../src/shared/rules.js';
import {
  setOpeningsMap, epdOf, lookup, isBook, deepestOpening,
} from '../src/analysis/openings.js';

// Replay UCI-ish moves and collect the FEN after each.
function fensAfter(moves) {
  const g = createGame();
  const fens = [];
  for (const m of moves) { tryMove(g, m); fens.push(g.fen()); }
  return fens;
}

// 1.e4 e5 2.Nf3 — build the map from the real positions these produce.
const line = [
  { from: 'e2', to: 'e4' },
  { from: 'e7', to: 'e5' },
  { from: 'g1', to: 'f3' },
];
const fens = fensAfter(line);
const MAP = {
  [epdOf(fens[0])]: { eco: 'B00', name: "King's Pawn" },
  [epdOf(fens[1])]: { eco: 'C20', name: "King's Pawn Game" },
  [epdOf(fens[2])]: { eco: 'C40', name: "King's Knight Opening" },
};

test('epdOf keeps the first four FEN fields only', () => {
  const g = createGame();
  // startpos FEN ends with " 0 1"; EPD drops those counters.
  assert.equal(epdOf(g.fen()), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
});

test('lookup / isBook hit known positions and miss others', () => {
  setOpeningsMap(MAP);
  assert.deepEqual(lookup(fens[0]), { eco: 'B00', name: "King's Pawn" });
  assert.equal(isBook(fens[2]), true);

  // An off-book position (1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 ... not in our map).
  const off = fensAfter([...line, { from: 'b8', to: 'c6' }, { from: 'f1', to: 'b5' }]);
  assert.equal(isBook(off[off.length - 1]), false);
  assert.equal(lookup(off[off.length - 1]), null);
});

test('deepestOpening returns the deepest unbroken book line', () => {
  setOpeningsMap(MAP);
  const res = deepestOpening(fens);
  assert.deepEqual(res, { eco: 'C40', name: "King's Knight Opening", ply: 3 });
});

test('deepestOpening stops at the first off-book move', () => {
  setOpeningsMap(MAP);
  // Replace move 2 with a non-book move: 1.e4 e5 2.Qh5 — only the first two are book.
  const broken = fensAfter([
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
    { from: 'd1', to: 'h5' },
  ]);
  const res = deepestOpening(broken);
  assert.deepEqual(res, { eco: 'C20', name: "King's Pawn Game", ply: 2 });
});

test('no map → lookups are null', () => {
  setOpeningsMap(null);
  assert.equal(lookup(fens[0]), null);
  assert.equal(isBook(fens[0]), false);
  assert.equal(deepestOpening(fens), null);
});
