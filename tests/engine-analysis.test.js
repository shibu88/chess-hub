// Analysis-mode engine tests: the info-line parser (pure) and a real-engine
// `go nodes N` + MultiPV 2 search. The WASM engine is a per-process singleton,
// so this lives in its own file (node --test isolates files in subprocesses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseInfoLine } from '../src/shared/engine.js';

const require = createRequire(import.meta.url);
const NODE_ENGINE = 'node_modules/stockfish/bin/stockfish-19-lite-single.js';

test('parseInfoLine pulls multipv, score and pv from an info line', () => {
  assert.deepEqual(
    parseInfoLine('info depth 12 seldepth 18 multipv 2 score cp -14 nodes 123456 pv e7e5 g1f3 b8c6'),
    { multipv: 2, score: { type: 'cp', value: -14 }, pvUci: ['e7e5', 'g1f3', 'b8c6'], bestUci: 'e7e5' },
  );
  // Mate score, implicit multipv 1.
  assert.deepEqual(
    parseInfoLine('info depth 20 score mate 3 pv d1h5 e8e7 h5e5'),
    { multipv: 1, score: { type: 'mate', value: 3 }, pvUci: ['d1h5', 'e8e7', 'h5e5'], bestUci: 'd1h5' },
  );
  // Lines without a usable score+pv are ignored.
  assert.equal(parseInfoLine('info depth 1 currmove e2e4 currmovenumber 1'), null);
  assert.equal(parseInfoLine('info string NNUE evaluation using ...'), null);
  assert.equal(parseInfoLine('bestmove e2e4'), null);
});

test('go nodes N with MultiPV 2 returns two scored lines', { timeout: 30000 }, async () => {
  const initEngine = require('stockfish');
  const engine = initEngine(NODE_ENGINE);

  const lines = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine timed out')), 25000);
    const seen = new Map();
    engine.listener = (line) => {
      const info = parseInfoLine(line);
      if (info) seen.set(info.multipv, info);
      if (/^bestmove\s/.test(line)) { clearTimeout(timer); resolve(seen); }
    };
    engine.processCommand('uci');
    engine.processCommand('isready');
    engine.processCommand('setoption name MultiPV value 2');
    engine.processCommand('position startpos');
    engine.processCommand('go nodes 200000'); // fixed budget → device-independent
  });

  try { engine.terminate(); } catch { /* ignore */ }

  const first = lines.get(1);
  const second = lines.get(2);
  assert.ok(first && second, 'expected two MultiPV lines');
  assert.match(first.bestUci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  assert.match(second.bestUci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  assert.notEqual(first.bestUci, second.bestUci); // two distinct candidate moves
  assert.ok(['cp', 'mate'].includes(first.score.type));
});
