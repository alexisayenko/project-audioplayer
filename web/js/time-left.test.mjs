import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtRemaining, fmtRemainingClock } from './time-left.js';

test('remaining time rounds up so -0:00 appears only at the end', () => {
  assert.equal(fmtRemaining(221, 256), '-0:35');
  assert.equal(fmtRemaining(221.4, 256), '-0:35');
  assert.equal(fmtRemaining(255.2, 256), '-0:01');
  assert.equal(fmtRemaining(256, 256), '-0:00');
  assert.equal(fmtRemaining(0, 256), '-4:16');
});

test('remaining time uses hours and clamps past the end', () => {
  assert.equal(fmtRemaining(0, 3725), '-1:02:05');
  assert.equal(fmtRemaining(10, 3600), '-59:50');
  assert.equal(fmtRemaining(300, 256), '-0:00');
  assert.equal(fmtRemaining(-5, 60), '-1:00');
});

test('unknown duration has no remaining time', () => {
  for (const d of [NaN, Infinity, 0, undefined, null, -1]) assert.equal(fmtRemaining(5, d), null);
  assert.equal(fmtRemainingClock(5, NaN), null);
});

test('studio clock remaining keeps tenths and rounds up', () => {
  assert.equal(fmtRemainingClock(1.23, 10), '-0:08.8');
  assert.equal(fmtRemainingClock(0, 75.5), '-1:15.5');
  assert.equal(fmtRemainingClock(10, 10), '-0:00.0');
});
