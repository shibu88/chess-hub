// Tests the game-review orchestration (src/analysis/engine-analysis.js) with a
// fake engine, so the metric/label wiring is verified without real Stockfish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseGame } from '../src/analysis/engine-analysis.js';
import { LABELS } from '../src/analysis/review.js';

// A fake engine that returns scripted MultiPV lines in call order. Records how
// many times it was asked (so we can prove terminal positions are not searched).
function fakeEngine(responses) {
  const state = { calls: 0 };
  return {
    engine: { analyse: async () => responses[state.calls++] },
    state,
  };
}
const line = (mpv, cp, uci) => ({ multipv: mpv, score: { type: 'cp', value: cp }, pvUci: [uci], bestUci: uci });

test('analyseGame: best moves score ~100 and are labelled Best', async () => {
  const { engine } = fakeEngine([
    [line(1, 20, 'e2e4'), line(2, 10, 'd2d4')], // pos0 white to move, best e4
    [line(1, -15, 'e7e5'), line(2, -30, 'c7c5')], // pos1 black to move, best e5
    [line(1, 25, 'g1f3'), line(2, 10, 'b1c3')], // pos2 white to move
  ]);
  const review = await analyseGame(engine, { baseFen: null, moves: [{ san: 'e4' }, { san: 'e5' }] });

  assert.equal(review.moves.length, 2);
  assert.equal(review.moves[0].label, 'Best');
  assert.equal(review.moves[1].label, 'Best');
  assert.ok(review.accuracy.white > 95 && review.accuracy.black > 95);
  assert.equal(review.whiteWin.length, 3); // N+1 positions
  assert.ok(LABELS.includes(review.moves[0].label));
});

test('analyseGame: a big eval swing on a non-best move is a Blunder', async () => {
  const { engine } = fakeEngine([
    [line(1, 50, 'd2d4'), line(2, 40, 'g1f3')],  // pos0: best is d4, White a bit better
    [line(1, 400, 'd7d5'), line(2, 380, 'g8f6')], // pos1: Black (to move) is now winning big
  ]);
  const review = await analyseGame(engine, { baseFen: null, moves: [{ san: 'e4' }] });

  assert.equal(review.moves.length, 1);
  assert.equal(review.moves[0].label, 'Blunder');
  assert.ok(review.moves[0].loss > 20, `loss ${review.moves[0].loss}`);
  assert.equal(review.moves[0].bestSan, 'd4');
});

test('analyseGame: the final checkmated position is not searched', async () => {
  // Fool's mate: 1. f3 e5 2. g4 Qh4#  → 4 moves, 5 positions, last is checkmate.
  const { engine, state } = fakeEngine([
    [line(1, 10, 'f2f3')],
    [line(1, -20, 'e7e5')],
    [line(1, 15, 'g2g4')],
    [line(1, -900, 'd8h4')], // Black to move, about to mate
  ]);
  const review = await analyseGame(engine, {
    baseFen: null, moves: [{ san: 'f3' }, { san: 'e5' }, { san: 'g4' }, { san: 'Qh4#' }],
  });

  assert.equal(review.moves.length, 4);
  assert.equal(state.calls, 4); // 5 positions, but the checkmate is NOT searched
  // The mating move leaves Black winning (~97.5% in White's-view flip).
  assert.ok(review.moves[3].winAfter > 95, `winAfter ${review.moves[3].winAfter}`);
});

test('analyseGame: reports progress (done, total)', async () => {
  const { engine } = fakeEngine([[line(1, 0, 'e2e4')], [line(1, 0, 'e7e5')]]);
  const seen = [];
  await analyseGame(engine, { baseFen: null, moves: [{ san: 'e4' }] }, {
    onProgress: (done, total) => seen.push([done, total]),
  });
  assert.equal(seen.at(-1)[0], seen.at(-1)[1]); // ends at done === total
  assert.equal(seen[0][1], 2);                   // total = N+1 positions
});

test('analyseGame: returns null when cancelled', async () => {
  const { engine } = fakeEngine([[line(1, 0, 'e2e4')], [line(1, 0, 'e7e5')]]);
  const review = await analyseGame(engine, { baseFen: null, moves: [{ san: 'e4' }] }, {
    isCancelled: () => true,
  });
  assert.equal(review, null);
});
