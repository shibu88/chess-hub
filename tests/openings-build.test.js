// Unit tests for the openings-build helpers (no network). Verifies the TSV is
// read by header name, PGNs replay to the right EPD, and the map matches what
// the runtime lookup (src/analysis/openings.js) expects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, epdForPgn, buildMap } from '../scripts/openings-build-lib.mjs';
import { createGame, tryMove } from '../src/shared/rules.js';
import { epdOf, setOpeningsMap, lookup } from '../src/analysis/openings.js';

const TSV = [
  'eco\tname\tpgn',
  'B00\tKing\'s Pawn\t1. e4',
  'C20\tKing\'s Pawn Game\t1. e4 e5',
  'C40\tKing\'s Knight Opening\t1. e4 e5 2. Nf3',
].join('\n');

test('parseTsv reads columns by header name (order-independent)', () => {
  const rows = parseTsv(TSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { eco: 'B00', name: "King's Pawn", pgn: '1. e4' });
  // Columns located by name, not position:
  const reordered = parseTsv(['name\tpgn\teco', "King's Pawn\t1. e4\tB00"].join('\n'));
  assert.deepEqual(reordered[0], { eco: 'B00', name: "King's Pawn", pgn: '1. e4' });
});

test('epdForPgn matches the runtime epdOf for the same position', () => {
  const g = createGame();
  tryMove(g, { from: 'e2', to: 'e4' });
  assert.equal(epdForPgn('1. e4'), epdOf(g.fen()));
});

test('buildMap produces a map the runtime lookup can read', () => {
  const { map, kept, skipped } = buildMap(parseTsv(TSV));
  assert.equal(kept, 3);
  assert.equal(skipped, 0);

  setOpeningsMap(map);
  const g = createGame();
  tryMove(g, { from: 'e2', to: 'e4' });
  tryMove(g, { from: 'e7', to: 'e5' });
  tryMove(g, { from: 'g1', to: 'f3' });
  assert.deepEqual(lookup(g.fen()), { eco: 'C40', name: "King's Knight Opening" });
});

test('buildMap skips rows with empty or invalid PGN', () => {
  const rows = [
    { eco: 'X', name: 'empty', pgn: '' },
    { eco: 'Y', name: 'garbage', pgn: '1. zz9 qq0' },
    { eco: 'B00', name: "King's Pawn", pgn: '1. e4' },
  ];
  const { kept, skipped } = buildMap(rows);
  assert.equal(kept, 1);
  assert.equal(skipped, 2);
});
