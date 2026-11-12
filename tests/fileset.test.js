import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFiles, hasReady } from '../src/analysis/fileset.js';

const byLabel = (report, label) => report.groups.find((g) => g.label === label);

test('PGN and ZIP are ready to read now', () => {
  const r = classifyFiles(['game.pgn', 'db.zip']);
  assert.equal(byLabel(r, 'game.pgn').status, 'ready');
  assert.equal(byLabel(r, 'db.zip').status, 'ready');
  assert.equal(hasReady(r), true);
});

test('a complete Scid 4 set is ready to read', () => {
  const r = classifyFiles(['x.si4', 'x.sg4', 'x.sn4']);
  const g = byLabel(r, 'x');
  assert.equal(g.kind, 'scid4');
  assert.equal(g.status, 'ready');
  assert.deepEqual(g.missing, []);
  assert.equal(hasReady(r), true);
});

test('a complete Scid 5 set is ready to read', () => {
  const r = classifyFiles(['x.si5', 'x.sg5', 'x.sn5']);
  const g = byLabel(r, 'x');
  assert.equal(g.kind, 'scid5');
  assert.equal(g.status, 'ready');
  assert.deepEqual(g.missing, []);
  assert.equal(hasReady(r), true);
});

test('an incomplete Scid 4 set is "incomplete" and names the missing companion files', () => {
  const r = classifyFiles(['x.si4', 'x.sg4']);
  const g = byLabel(r, 'x');
  assert.equal(g.status, 'incomplete');
  assert.deepEqual(g.missing, ['x.sn4']);
  assert.match(g.message, /missing .*\.sn4/);
  assert.equal(hasReady(r), false);
});

test('an incomplete Scid 5 set names the missing companion files', () => {
  const g = byLabel(classifyFiles(['x.si5', 'x.sn5']), 'x');
  assert.equal(g.status, 'incomplete');
  assert.deepEqual(g.missing, ['x.sg5']);
});

test('a complete ChessBase set is ready to read', () => {
  const g = byLabel(classifyFiles(['y.cbh', 'y.cbg', 'y.cbp', 'y.cbt']), 'y');
  assert.equal(g.kind, 'chessbase');
  assert.equal(g.status, 'ready');
  assert.deepEqual(g.missing, []);
  assert.equal(hasReady(classifyFiles(['y.cbh', 'y.cbg', 'y.cbp', 'y.cbt'])), true);
});

test('optional ChessBase files (.cba/.cbc/.cbs) are included but never "missing"', () => {
  const g = byLabel(classifyFiles(['y.cbh', 'y.cbg', 'y.cbp', 'y.cbt', 'y.cba', 'y.cbs']), 'y');
  assert.equal(g.status, 'ready');
  assert.deepEqual(g.missing, []);
  assert.ok(g.files.includes('y.cba') && g.files.includes('y.cbs'));
});

test('an incomplete ChessBase set names the missing required files', () => {
  const g = byLabel(classifyFiles(['y.cbh', 'y.cbg']), 'y');
  assert.equal(g.status, 'incomplete');
  assert.deepEqual(g.missing, ['y.cbp', 'y.cbt']);
  assert.match(g.message, /missing .*\.cbp.*\.cbt/);
});

test('cbv / cbone / unknown extensions are unsupported with PGN advice', () => {
  const r = classifyFiles(['a.cbv', 'b.cbone', 'c.xyz']);
  for (const label of ['a.cbv', 'b.cbone', 'c.xyz']) {
    assert.equal(byLabel(r, label).status, 'unsupported');
  }
  assert.match(byLabel(r, 'a.cbv').message, /PGN/);
  assert.equal(hasReady(r), false);
});
