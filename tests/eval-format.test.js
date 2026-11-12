import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtEval } from '../src/analysis/eval-format.js';

test('formats a White advantage with a + and two decimals', () => {
  assert.equal(fmtEval(84), '+0.84');
  assert.equal(fmtEval(21), '+0.21');
  assert.equal(fmtEval(5), '+0.05');
});

test('formats a Black advantage with a − (U+2212) and two decimals', () => {
  assert.equal(fmtEval(-102), '−1.02');
  assert.equal(fmtEval(-7), '−0.07');
});

test('zero is +0.00', () => {
  assert.equal(fmtEval(0), '+0.00');
});

test('a mate / clamped score (|cp| ≥ 1000) shows as +10+ / −10+', () => {
  assert.equal(fmtEval(1000), '+10+');
  assert.equal(fmtEval(1500), '+10+');
  assert.equal(fmtEval(-1000), '−10+');
  assert.equal(fmtEval(-2000), '−10+');
});

test('rounds to two decimals', () => {
  assert.equal(fmtEval(846), '+8.46');
  assert.equal(fmtEval(999), '+9.99');
  assert.equal(fmtEval(-123), '−1.23');
});
