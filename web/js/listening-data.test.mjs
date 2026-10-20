import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHm, topListened, topSkipped, hasListeningData } from './stats-listening.js';

const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const data = { songs: {
  a: { total_listened_s: 3600, skipped: { all: 0 } },
  b: { total_listened_s: 7500, skipped: { all: 4 } },
  c: { total_listened_s: 0, skipped: { all: 9 } },
  gone: { total_listened_s: 99999, skipped: { all: 99 } },
} };

test('formatHm', () => {
  assert.equal(formatHm(0), '0 min');
  assert.equal(formatHm(3600), '1 h');
  assert.equal(formatHm(7500), '2 h 5 min');
});

test('top lists skip unknown songs and zeros', () => {
  assert.deepEqual(topListened(data, songs).map((r) => r.song.id), ['b', 'a']);
  assert.deepEqual(topSkipped(data, songs).map((r) => r.song.id), ['c', 'b']);
  assert.equal(hasListeningData({ songs: {} }, songs), false);
});
