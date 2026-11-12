// Rules helpers (over chess.js). Pure logic, runs under `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidFen, createGame, legalDests, isPromotion, kingSquare, tryMove,
  onlyOneLegalMove, gameResult, SQUARES,
} from '../src/shared/rules.js';

test('SQUARES covers the whole board a8..h1', () => {
  assert.equal(SQUARES.length, 64);
  assert.equal(SQUARES[0], 'a8');
  assert.equal(SQUARES[63], 'h1');
});

test('isValidFen accepts the start position and rejects junk', () => {
  assert.equal(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), true);
  assert.equal(isValidFen('not a fen'), false);
});

test('legalDests from e2 at the start includes e3 and e4', () => {
  const g = createGame();
  const dests = legalDests(g, 'e2');
  assert.ok(dests.includes('e3'));
  assert.ok(dests.includes('e4'));
});

test('isPromotion detects a pawn reaching the last rank', () => {
  const g = createGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(isPromotion(g, 'a7', 'a8'), true);
  const g2 = createGame();
  assert.equal(isPromotion(g2, 'e2', 'e4'), false);
});

test('kingSquare finds both kings', () => {
  const g = createGame();
  assert.equal(kingSquare(g, 'w'), 'e1');
  assert.equal(kingSquare(g, 'b'), 'e8');
});

test('tryMove returns the move for legal input and null for illegal', () => {
  const g = createGame();
  assert.ok(tryMove(g, { from: 'e2', to: 'e4' }));
  assert.equal(tryMove(g, { from: 'e2', to: 'e5' }), null); // pawn can't jump 3
});

test('onlyOneLegalMove is true when a single reply exists', () => {
  const forced = createGame('4k2r/1b6/8/8/8/8/8/7K w - - 0 1');
  assert.equal(onlyOneLegalMove(forced), true);
  assert.equal(onlyOneLegalMove(createGame()), false);
});

test('gameResult: checkmate (fool\'s mate) → Black wins', () => {
  const g = createGame();
  for (const m of ['f3', 'e5', 'g4', 'Qh4']) g.move(m);
  assert.deepEqual(gameResult(g), { over: true, result: '0-1', reason: 'checkmate' });
});

test('gameResult: stalemate → draw', () => {
  const g = createGame('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
  const r = gameResult(g);
  assert.equal(r.over, true);
  assert.equal(r.result, '1/2-1/2');
  assert.equal(r.reason, 'stalemate');
});

test('gameResult: lone kings → insufficient material draw', () => {
  const g = createGame('k7/8/8/8/8/8/8/K7 w - - 0 1');
  const r = gameResult(g);
  assert.equal(r.result, '1/2-1/2');
  assert.equal(r.reason, 'insufficient material');
});

test('gameResult: ongoing game is not over', () => {
  assert.equal(gameResult(createGame()).over, false);
});
