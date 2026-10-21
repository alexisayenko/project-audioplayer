import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHm, formatTimes, topListened, topSkipped, hasListeningData } from './stats-listening.js';

const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const data = { songs: {
  a: { total_listened_s: 3600, listened: { all: 12 }, skipped: { all: 0 } },
  b: { total_listened_s: 7500, listened: { all: 12 }, skipped: { all: 4 } },
  c: { total_listened_s: 900, listened: { all: 0 }, skipped: { all: 9 } },
  gone: { total_listened_s: 99999, listened: { all: 99 }, skipped: { all: 99 } },
} };

test('formatHm', () => {
  assert.equal(formatHm(0), '0 min');
  assert.equal(formatHm(3600), '1 h');
  assert.equal(formatHm(7500), '2 h 5 min');
});

test('formatTimes', () => {
  assert.equal(formatTimes(1), '1 time');
  assert.equal(formatTimes(12), '12 times');
});

test('most listened ranks by count, ties by listened time, skips zero counts', () => {
  assert.deepEqual(topListened(data, songs).map((r) => [r.song.id, r.value]), [['b', 12], ['a', 12]]);
});

test('top lists skip unknown songs and zeros', () => {  assert.deepEqual(topSkipped(data, songs).map((r) => r.song.id), ['c', 'b']);
  assert.equal(hasListeningData({ songs: {} }, songs), false);
});
