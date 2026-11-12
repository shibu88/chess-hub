import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllGames, movetextToSan } from '../src/analysis/pgn-parse.js';
import { createGame } from '../src/shared/rules.js';

test('movetextToSan keeps the main line and strips the rest', () => {
  const mt = '1. e4 { [%clk 0:03:00] } e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6!? 3. Bb5 a6!! 1-0';
  assert.deepEqual(movetextToSan(mt), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
});

test('movetextToSan normalises 0-0 castling and keeps promotion/check', () => {
  assert.deepEqual(movetextToSan('1. e4 e5 2. O-O O-O-O 3. e8=Q+ Qxf7#'),
    ['e4', 'e5', 'O-O', 'O-O-O', 'e8=Q+', 'Qxf7#']);
  assert.deepEqual(movetextToSan('5... 0-0'), ['O-O']);
});

test('parseAllGames reads headers, main line, BOM and CRLF', () => {
  const pgn = '﻿[Event "Test"]\r\n[White "Alice"]\r\n[Black "Bob"]\r\n[Result "1-0"]\r\n\r\n1. e4 e5 2. Nf3 1-0\r\n';
  const { games, errors } = parseAllGames(pgn);
  assert.equal(errors.length, 0);
  assert.equal(games.length, 1);
  assert.equal(games[0].headers.White, 'Alice');
  assert.equal(games[0].plyCount, 3);
  assert.deepEqual(games[0].sanList, ['e4', 'e5', 'Nf3']);
});

test('parseAllGames carries the FEN for a SetUp game', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 1-0\n`;
  const { games } = parseAllGames(pgn);
  assert.equal(games[0].baseFen, fen);
  // The main line is replayable from that FEN.
  const g = createGame(games[0].baseFen);
  assert.ok(g.move(games[0].sanList[0]));
});

test('parseAllGames splits multiple games and recovers from a broken one', () => {
  const big = 'x'.repeat(1024 * 1024 + 10); // > 1 MB movetext → reported, skipped
  const pgn = [
    '[White "A"]\n[Black "B"]\n\n1. e4 e5 *',
    `[White "Huge"]\n[Black "X"]\n\n1. ${big} *`,
    '[White "C"]\n[Black "D"]\n\n1. d4 d5 *',
  ].join('\n\n');
  const { games, errors } = parseAllGames(pgn);
  assert.equal(games.length, 2);          // the two good games survive
  assert.equal(errors.length, 1);         // the oversized one is reported
  assert.deepEqual(games.map((g) => g.headers.White), ['A', 'C']);
});

test('parseAllGames handles 10,000+ games', () => {
  let text = '';
  for (let i = 0; i < 10000; i += 1) {
    text += `[Event "G${i}"]\n[White "W${i}"]\n[Black "B${i}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n\n`;
  }
  let progressCalls = 0;
  const { games, errors } = parseAllGames(text, { onProgress: () => { progressCalls += 1; } });
  assert.equal(games.length, 10000);
  assert.equal(errors.length, 0);
  assert.equal(games[0].headers.White, 'W0');
  assert.equal(games[9999].plyCount, 6);
  assert.ok(progressCalls >= 1);
});
