import test from 'node:test';
import assert from 'node:assert/strict';
import { tableRows, sortRows, nextSort, formatLength, formatCount, formatListened } from './library-table.js';

const songs = [
  { id: 'a', artist: 'Zed', title: 'Alpha', duration: 125 },
  { id: 'b', artist: 'Amy', title: 'Beta', duration: 0 },
  { id: 'c', artist: 'Bob', title: 'Gamma', duration: 200 },
  { id: 'd', artist: 'Dan', title: 'Never played', duration: 90 },
];
const data = { songs: {
  a: { listened: { all: 3 }, skipped: { all: 1 }, total_listened_s: 3600 },
  b: { listened: { all: 9 }, skipped: { all: 0 }, total_listened_s: 7500 },
  c: { listened: { all: 0 }, skipped: { all: 4 }, total_listened_s: 20 },
  gone: { listened: { all: 5 }, skipped: { all: 5 }, total_listened_s: 99999 },
} };
const ids = (rows) => rows.map((r) => r.song.id);

test('formats', () => {
  assert.equal(formatLength(125), '2:05');
  assert.equal(formatLength(0), '-');
  assert.equal(formatCount(null), '-');
  assert.equal(formatCount(0), '0');
  assert.equal(formatListened(0), '-');
  assert.equal(formatListened(null), '-');
  assert.equal(formatListened(20), 'under 1 min');
  assert.equal(formatListened(7500), '2 h 5 min');
});

test('rows keep the given song order, including songs without plays', () => {
  const rows = tableRows(songs, data);
  assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd']);
  assert.deepEqual([rows[3].listened, rows[3].skipped, rows[3].total], [0, 0, 0]);
  assert.equal(rows[0].label, 'Zed - Alpha');
});

test('without listening data stat cells are null', () => {
  const rows = tableRows(songs, null);
  assert.equal(rows[0].listened, null);
  assert.equal(rows[0].total, null);
});

test('no sort keeps the Library order', () => {
  const rows = tableRows(songs, data);
  assert.equal(sortRows(rows, null), rows);
});

test('sorting by each column', () => {
  const rows = tableRows(songs, data);
  assert.deepEqual(ids(sortRows(rows, { key: 'total', dir: -1 })), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids(sortRows(rows, { key: 'skipped', dir: -1 })), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(sortRows(rows, { key: 'listened', dir: 1 })), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids(sortRows(rows, { key: 'length', dir: 1 })), ['b', 'd', 'a', 'c']);
  assert.deepEqual(ids(sortRows(rows, { key: 'song', dir: 1 })), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids(sortRows(rows, { key: 'song', dir: -1 })), ['a', 'd', 'c', 'b']);
});

test('header cycles: default direction, opposite, cleared', () => {
  let s = nextSort(null, 'total');
  assert.deepEqual(s, { key: 'total', dir: -1 });
  s = nextSort(s, 'total');
  assert.deepEqual(s, { key: 'total', dir: 1 });
  assert.equal(nextSort(s, 'total'), null);
  assert.deepEqual(nextSort(s, 'song'), { key: 'song', dir: 1 });
  assert.deepEqual(nextSort({ key: 'song', dir: 1 }, 'song'), { key: 'song', dir: -1 });
});
