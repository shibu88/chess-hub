import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzleSolver, parseUci, toUci } from '../src/training/puzzle.js';

// Real puzzles from the generated Lichess data (public/puzzles/*).
const BASIC = { fen: '7r/1p3k2/p1p3pr/P1Pp1pqn/1P5P/4PP2/2B3RP/6RK w - - 0 37', moves: 'h4g5 h5g3 g2g3 h6h2' };
const ALT_MATE = { fen: 'r1b2kr1/6b1/p5Q1/1p3p2/3pqp1P/P7/1PP2P2/4RKR1 b - - 3 25', moves: 'e4d5 e1e8' };
const PROMO = { fen: '8/8/6P1/3B4/8/2b1k3/3p3p/3K4 b - - 11 69', moves: 'e3d4 g6g7 d4d5 g7g8q' };

const uci = (u) => parseUci(u);

test('parseUci / toUci round-trip including promotion', () => {
  assert.deepEqual(parseUci('e2e4'), { from: 'e2', to: 'e4', promotion: undefined });
  assert.deepEqual(parseUci('e7e8q'), { from: 'e7', to: 'e8', promotion: 'q' });
  assert.equal(toUci({ from: 'e7', to: 'e8', promotion: 'q' }), 'e7e8q');
  assert.equal(toUci({ from: 'g1', to: 'f3' }), 'g1f3');
});

test('the opponent moves first; the solver faces the reply', () => {
  const p = createPuzzleSolver(BASIC);
  assert.equal(p.solverColor, 'b');          // White (to move in FEN) is the opponent
  assert.equal(p.orientation, 'black');
  const first = p.firstMove();
  assert.deepEqual({ from: first.from, to: first.to }, { from: 'h4', to: 'g5' });
  assert.equal(p.status, 'solving');
  assert.equal(p.expectedUci(), 'h5g3');
  assert.equal(p.hintSquare(), 'h5');
});

test('a correct multi-move solve: continue (with reply) then solved', () => {
  const p = createPuzzleSolver(BASIC);
  p.firstMove();

  const r1 = p.tryUser(uci('h5g3'));
  assert.equal(r1.status, 'continue');
  assert.deepEqual({ from: r1.userMove.from, to: r1.userMove.to }, { from: 'h5', to: 'g3' });
  assert.deepEqual({ from: r1.replyMove.from, to: r1.replyMove.to }, { from: 'g2', to: 'g3' });
  assert.equal(p.expectedUci(), 'h6h2');

  const r2 = p.tryUser(uci('h6h2'));
  assert.equal(r2.status, 'solved');
  assert.equal(p.solved, true);
  assert.equal(p.done, true);
  // moves after the puzzle is finished are ignored
  assert.equal(p.tryUser(uci('h2h1')).status, 'ignored');
});

test('a wrong move is reported without changing state', () => {
  const p = createPuzzleSolver(BASIC);
  p.firstMove();
  const before = p.currentFen();
  const r = p.tryUser(uci('b7b6')); // legal, but not the solution
  assert.equal(r.status, 'wrong');
  assert.equal(p.currentFen(), before);    // not mutated
  assert.equal(p.expectedUci(), 'h5g3');   // still waiting for the right move
  assert.equal(p.tryUser(uci('g8g7')).status, 'wrong'); // an illegal-for-the-puzzle try
});

test('any checkmating move solves a mate-in-one, even a different one', () => {
  const p = createPuzzleSolver(ALT_MATE);
  p.firstMove();
  assert.equal(p.expectedUci(), 'e1e8');       // the recorded mate (Re8#)
  const r = p.tryUser(uci('g6e8'));            // a different mate (Qe8#)
  assert.equal(r.status, 'solved');
  assert.equal(p.solved, true);
});

test('a promotion solution is accepted; a wrong promotion piece is not', () => {
  const p = createPuzzleSolver(PROMO);
  p.firstMove();                               // opponent Ke3–d4
  const r1 = p.tryUser(uci('g6g7'));
  assert.equal(r1.status, 'continue');
  assert.deepEqual({ from: r1.replyMove.from, to: r1.replyMove.to }, { from: 'd4', to: 'd5' });
  assert.equal(p.expectedUci(), 'g7g8q');

  assert.equal(p.tryUser(uci('g7g8r')).status, 'wrong'); // right square, wrong piece
  const r2 = p.tryUser(uci('g7g8q'));
  assert.equal(r2.status, 'solved');
});

test('undo takes back the solver move + reply, back to the decision point', () => {
  const p = createPuzzleSolver(BASIC);
  p.firstMove();
  assert.equal(p.canUndo(), false);          // nothing played yet
  assert.equal(p.undo(), null);

  const r = p.tryUser(uci('h5g3'));          // correct → app replies g2g3
  assert.equal(r.status, 'continue');
  assert.equal(p.expectedUci(), 'h6h2');
  assert.equal(p.canUndo(), true);

  const back = p.undo();
  assert.ok(back && back.fen);
  assert.deepEqual({ from: back.from, to: back.to }, { from: 'h4', to: 'g5' }); // opponent's move is last again
  assert.equal(p.expectedUci(), 'h5g3');     // waiting for the same move again
  assert.equal(p.canUndo(), false);

  // replaying the solution still works after an undo
  assert.equal(p.tryUser(uci('h5g3')).status, 'continue');
  assert.equal(p.tryUser(uci('h6h2')).status, 'solved');
});

test('revealSolution plays out the rest and marks the puzzle failed', () => {
  const p = createPuzzleSolver(BASIC);
  p.firstMove();
  const steps = p.revealSolution();
  assert.equal(steps.length, 3);               // h5g3, g2g3, h6h2
  assert.deepEqual({ from: steps[0].from, to: steps[0].to }, { from: 'h5', to: 'g3' });
  assert.ok(steps[2].fen);                     // each step carries the resulting FEN
  assert.equal(p.done, true);
  assert.equal(p.solved, false);               // showing the solution counts as failed
});
