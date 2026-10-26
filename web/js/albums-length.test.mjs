import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { albumLength, formatTotalLength, SOME_UNKNOWN } = await import('./albums-model.js');

const t = (...secs) => secs.map((durationS, i) => ({ no: i + 1, title: `T${i + 1}`, durationS }));

test('formatTotalLength: seconds under a minute, minutes under an hour, hours with padded minutes', () => {
  assert.equal(formatTotalLength(45), '45 s');
  assert.equal(formatTotalLength(59), '59 s');
  assert.equal(formatTotalLength(60), '1 min');
  assert.equal(formatTotalLength(48 * 60), '48 min');
  assert.equal(formatTotalLength(72 * 60), '1 h 12 min');
  assert.equal(formatTotalLength(3600), '1 h 00 min');
  assert.equal(formatTotalLength(5 * 3600 + 7 * 60), '5 h 07 min');
});

test('formatTotalLength rounds to the nearest minute, never floors', () => {
  assert.equal(formatTotalLength(3599), '1 h 00 min');
  assert.equal(formatTotalLength(89), '1 min');
  assert.equal(formatTotalLength(90), '2 min');
  assert.equal(formatTotalLength(59.6), '1 min');
  assert.equal(formatTotalLength(3570), '1 h 00 min');
  assert.equal(formatTotalLength(3569), '59 min');
});

test('albumLength: no tracks and no known durations give nothing, not "0 min"', () => {
  assert.equal(albumLength([]), null);
  assert.equal(albumLength(undefined), null);
  assert.equal(albumLength(t(null, undefined)), null);
  assert.equal(albumLength(t(0)), null);
});

test('albumLength: all known is exact, no tilde, no tooltip', () => {
  assert.deepEqual(albumLength(t(1800, 1800, 720)), { text: '1 h 12 min', approx: false, title: '' });
  assert.equal(albumLength(t(60 * 30, 60 * 30)).text, '1 h 00 min');
  assert.equal(albumLength(t(45)).text, '45 s');
});

test('albumLength: some unknown sums the known ones with a leading tilde and a tooltip', () => {
  assert.deepEqual(albumLength(t(1800, null, 2100)), { text: '~1 h 05 min', approx: true, title: SOME_UNKNOWN });
  assert.equal(SOME_UNKNOWN, 'Some tracks have no duration');
});
