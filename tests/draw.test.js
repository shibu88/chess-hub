// Draw-offer rule: declined before move 20; after that the engine accepts only
// if its own eval is +0.20 (20 cp) or less.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineDrawResponse } from '../src/play/draw.js';
import { createGame } from '../src/shared/rules.js';

// A game already at move 20 (player to move). Score below is from the player's side.
const MOVE20 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 20';
const fakeEngine = (score, calls = { n: 0 }) => ({ evaluate: async () => { calls.n += 1; return score; }, _calls: calls });

test('declined before move 20 without consulting the engine', async () => {
  const eng = fakeEngine({ type: 'cp', value: 0 });
  const r = await engineDrawResponse(createGame(), eng);
  assert.equal(r.accepted, false);
  assert.match(r.reason, /early/);
  assert.equal(eng._calls.n, 0);
});

test('after move 20: accepts when the engine is not better (eval 0)', async () => {
  const r = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'cp', value: 0 }));
  assert.equal(r.accepted, true);
});

test('after move 20: accepts when the engine is losing', async () => {
  // player much better → engine's view is very negative → accept
  const r = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'cp', value: 500 }));
  assert.equal(r.accepted, true);
});

test('after move 20: declines when the engine is clearly better', async () => {
  // engine winning → player's score very negative → engine's view +500 → decline
  const r = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'cp', value: -500 }));
  assert.equal(r.accepted, false);
});

test('boundary: engine eval exactly +0.20 accepts, +0.21 declines', async () => {
  const accept = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'cp', value: -20 }));
  const decline = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'cp', value: -21 }));
  assert.equal(accept.accepted, true);
  assert.equal(decline.accepted, false);
});

test('a mate against the engine declines; a mate for the engine declines', async () => {
  // player mating (engine losing) → accept; engine mating (player mated) → decline
  const engineLosing = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'mate', value: 3 }));
  const engineMating = await engineDrawResponse(createGame(MOVE20), fakeEngine({ type: 'mate', value: -3 }));
  assert.equal(engineLosing.accepted, true);
  assert.equal(engineMating.accepted, false);
});
