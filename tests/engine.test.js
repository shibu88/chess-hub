// Real-engine test: drives the actual Stockfish 19 lite single build over UCI
// in Node, and checks the file we ship is byte-identical to the npm engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);

// Node loads the engine as CommonJS from node_modules; the project is an ES
// module, so our shipped copy can't be require()d directly. We instead run the
// node_modules build (same bytes) and prove equality by hash below.
const NODE_ENGINE = 'node_modules/stockfish/bin/stockfish-19-lite-single.js';
const SHIPPED_ENGINE = 'public/engine/stockfish-19-lite-single.js';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('the shipped engine file matches the npm package build', () => {
  assert.equal(sha256(SHIPPED_ENGINE), sha256(NODE_ENGINE));
});

test('Stockfish answers uci and returns a legal-looking best move', { timeout: 30000 }, async () => {
  const initEngine = require('stockfish');
  const engine = initEngine(NODE_ENGINE);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine timed out')), 25000);
    let sawUciOk = false;
    engine.listener = (line) => {
      if (line === 'uciok') sawUciOk = true;
      const m = /^bestmove\s+(\S+)/.exec(line);
      if (m) { clearTimeout(timer); resolve({ sawUciOk, best: m[1] }); }
    };
    engine.processCommand('uci');
    engine.processCommand('isready');
    engine.processCommand('position startpos');
    engine.processCommand('go depth 8');
  });

  try { engine.terminate(); } catch { /* ignore */ }

  assert.equal(result.sawUciOk, true);
  assert.match(result.best, /^[a-h][1-8][a-h][1-8][qrbn]?$/); // valid UCI move
});
