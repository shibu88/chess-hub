// Clock logic, using node:test mock timers for deterministic time.
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/shared/clock.js';

afterEach(() => { try { mock.timers.reset(); } catch { /* not enabled */ } });

test('counts down the side to move and flags at zero', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const flags = [];
  const c = createClock({ initialMs: 1000, onFlag: (col) => flags.push(col) });
  c.setTurn('w');
  mock.timers.tick(300);
  assert.equal(c.getRemaining('w'), 700);
  assert.equal(c.getRemaining('b'), 1000); // the idle side doesn't move
  mock.timers.tick(800); // crosses zero
  assert.equal(c.getRemaining('w'), 0);
  assert.deepEqual(flags, ['w']);
  assert.equal(c.flagged, true);
  c.destroy();
});

test('setTurn(null) pauses the clock', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const c = createClock({ initialMs: 1000 });
  c.setTurn('w');
  mock.timers.tick(200);
  c.setTurn(null);
  const paused = c.getRemaining('w');
  mock.timers.tick(500);
  assert.equal(c.getRemaining('w'), paused); // unchanged while paused
  c.destroy();
});

test('engineBudget is one thirtieth of the remaining time', () => {
  const c = createClock({ initialMs: 300000 }); // 5 minutes
  assert.equal(c.engineBudget('w'), 10000); // 300000 / 30
  c.destroy();
});
