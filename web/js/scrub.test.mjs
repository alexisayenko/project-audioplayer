import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, fraction, positionToTime, keyTime, valueText, clock, usableDuration } from './scrub.js';

const rect = { left: 100, width: 200 };

test('positionToTime maps and clamps', () => {
  assert.equal(positionToTime(200, rect, 240), 120);
  assert.equal(positionToTime(100, rect, 240), 0);
  assert.equal(positionToTime(300, rect, 240), 240);
  assert.equal(positionToTime(-50, rect, 240), 0);
  assert.equal(positionToTime(900, rect, 240), 240);
});

test('positionToTime is null without a usable duration or width', () => {
  for (const d of [NaN, Infinity, 0, -1, undefined]) assert.equal(positionToTime(150, rect, d), null);
  assert.equal(positionToTime(150, { left: 0, width: 0 }, 100), null);
  assert.equal(positionToTime(NaN, rect, 100), null);
  assert.equal(usableDuration(Infinity), false);
});

test('clamp and fraction', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(NaN, 0, 3), 0);
  assert.equal(fraction(30, 120), 0.25);
  assert.equal(fraction(500, 120), 1);
  assert.equal(fraction(5, NaN), 0);
});

test('keyTime steps, clamps, jumps', () => {
  assert.equal(keyTime('ArrowRight', false, 10, 100), 15);
  assert.equal(keyTime('ArrowLeft', false, 10, 100), 5);
  assert.equal(keyTime('ArrowLeft', false, 3, 100), 0);
  assert.equal(keyTime('ArrowRight', true, 10, 100), 25);
  assert.equal(keyTime('ArrowLeft', true, 20, 100), 5);
  assert.equal(keyTime('ArrowRight', true, 95, 100), 100);
  assert.equal(keyTime('ArrowUp', false, 10, 100), 15);
  assert.equal(keyTime('ArrowDown', false, 10, 100), 5);
  assert.equal(keyTime('Home', false, 50, 100), 0);
  assert.equal(keyTime('End', false, 50, 100), 100);
  assert.equal(keyTime('a', false, 50, 100), null);
  assert.equal(keyTime('ArrowRight', false, 0, NaN), null);
});

test('valueText', () => {
  assert.equal(valueText(65, 213), '1:05 of 3:33');
  assert.equal(valueText(0, 3725), '0:00 of 1:02:05');
  assert.equal(valueText(5, NaN), '0:05 of 0:00');
  assert.equal(clock(-1), '0:00');
});
