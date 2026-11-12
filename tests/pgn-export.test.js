import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewToRecord, recordToPgn, buildPgn, toReviewJson } from '../src/analysis/pgn-export.js';
import { createGame } from '../src/shared/rules.js';

const review = {
  source: 'board', baseFen: null, startColor: 'w',
  headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Event: 'Test', ECO: 'C20' },
  engine: { version: 'SF', nodes: 150000 },
  accuracy: { white: 90, black: 40 },
  labelCounts: { w: { Best: 1 }, b: { Blunder: 1 } },
  opening: { eco: 'C20', name: 'King\'s Pawn', ply: 1 },
  moves: [
    { san: 'e4', label: 'Best', scoreWhiteCp: 20, accuracy: 100, bestUci: 'e2e4', bestSan: 'e4' },
    { san: 'f6', label: 'Blunder', scoreWhiteCp: 300, accuracy: 9.4, bestUci: 'g8f6', bestSan: 'Nf6' },
  ],
};

test('reviewToRecord builds a compact, store-ready record', () => {
  const rec = reviewToRecord(review);
  assert.equal(rec.source, 'board');
  assert.equal(rec.result, '1-0');
  assert.equal(rec.players.white, 'Alice');
  assert.equal(rec.review.moves.length, 2);
  assert.equal(rec.review.moves[1].best, 'g8f6');
  assert.equal(rec.review.moves[1].label, 'Blunder');
  assert.equal(typeof rec.pgn, 'string');
  // The stored (plain) PGN is legal and replayable.
  const g = createGame();
  g.loadPgn(rec.pgn);
  assert.equal(g.history().join(' '), 'e4 f6');
});

test('recordToPgn annotates each move with glyph, eval and a comment', () => {
  const rec = reviewToRecord(review);
  const pgn = recordToPgn(rec, true);
  assert.match(pgn, /\[%eval 0\.20\]/);
  assert.match(pgn, /f6\?\? \{ \[%eval 3\.00\] Blunder\. Best was Nf6\. \}/);
  assert.match(pgn, /\[White "Alice"\]/);
});

test('buildPgn plain has no annotations', () => {
  const pgn = buildPgn({ headers: review.headers, startColor: 'w', moves: review.moves, result: '1-0' }, false);
  assert.doesNotMatch(pgn, /%eval/);
  assert.doesNotMatch(pgn, /f6\?\?/);
});

test('buildPgn carries a SetUp/FEN start and its move number', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 7';
  const pgn = buildPgn({ headers: { White: 'W', Black: 'B' }, baseFen: fen, startColor: 'w', moves: [{ san: 'e4', label: 'Best', scoreWhiteCp: 0 }], result: '*' }, false);
  assert.match(pgn, /\[SetUp "1"\]/);
  assert.match(pgn, /\[FEN "4k3/);
  assert.match(pgn, /7\. e4/); // starts at move 7
});

test('toReviewJson returns the full per-move review', () => {
  const rec = reviewToRecord(review);
  const obj = JSON.parse(toReviewJson(rec));
  assert.equal(obj.review.moves.length, 2);
  assert.equal(obj.review.accuracy.white, 90);
  assert.equal(obj.source, 'board');
});
