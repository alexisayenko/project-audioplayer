import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, validateTrim, trimPayload } from './trim-fields.js';

test('parseTime reads m:ss, h:mm:ss, plain seconds and one decimal', () => {
  assert.equal(parseTime('1:25').value, 85);
  assert.equal(parseTime('01:02:03').value, 3723);
  assert.equal(parseTime('90').value, 90);
  assert.equal(parseTime(' 1:25.5 ').value, 85.5);
  assert.equal(parseTime('0:00').value, 0);
});

test('parseTime: empty is empty and ok, garbage is not ok', () => {
  assert.deepEqual(parseTime(''), { empty: true, value: null, ok: true });
  assert.equal(parseTime(null).empty, true);
  for (const bad of ['abc', '1:60', '1:2:3:4', '-5', '1:25.55', '1.5.5', '1:', ':30', '1m25s']) assert.equal(parseTime(bad).ok, false, bad);
});

test('formatTime', () => {
  assert.equal(formatTime(85), '1:25');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(85.5), '1:25.5');
  assert.equal(formatTime(9), '0:09');
  assert.equal(formatTime(-1), '');
});

test('validateTrim messages and length', () => {
  assert.equal(validateTrim('2:00', '1:00', 300).error, 'Start must be before End.');
  assert.equal(validateTrim('1:00', '2:00', 90).error, 'End is after the end of the track.');
  assert.equal(validateTrim('1:00', '1:00.5', 300).error, 'The cut must be at least 1 second.');
  assert.equal(validateTrim('x', '', 300).error, 'Start must look like 1:25 or 85.');
  assert.equal(validateTrim('', '', 180).length, 180);
  assert.deepEqual(validateTrim('0:30', '3:30', 300), { error: null, start: 30, end: 210, length: 180 });
  assert.equal(validateTrim('1:00', '', null).length, null);
  assert.equal(validateTrim('2:00', '', null).error, null);
});

test('trimPayload holds only the set values', () => {
  assert.equal(trimPayload(null, null), null);
  assert.equal(trimPayload(0, null), null);
  assert.deepEqual(trimPayload(85, null), { start: 85 });
  assert.deepEqual(trimPayload(null, 190), { end: 190 });
  assert.deepEqual(trimPayload(10, 20), { start: 10, end: 20 });
});
