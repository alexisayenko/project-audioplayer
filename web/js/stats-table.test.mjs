import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, rowValue, decadeLabel, COLUMNS } from './stats-table.js';

const songs = [
  { id: 'a', title: 'Beta', artist: 'Zed', year: 1999, bpm: 120 },
  { id: 'b', title: 'alpha', artist: 'Yan', year: 2005, bpm: 90, remixer: 'DJ X' },
  { id: 'c', title: 'Gamma', artist: 'Xi', year: 1984, bpm: 140 },
];

test('sortRows sorts text case-insensitively and numbers numerically in both directions', () => {
  assert.deepEqual(sortRows(songs, 'title').map((s) => s.id), ['b', 'a', 'c']);
  assert.deepEqual(sortRows(songs, 'artist', -1).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(sortRows(songs, 'year').map((s) => s.id), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(songs, 'bpm', -1).map((s) => s.id), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(songs, 'decade').map((s) => s.id), ['c', 'a', 'b']);
  assert.deepEqual(songs.map((s) => s.id), ['a', 'b', 'c']);
});

test('row values use the remix-aware title and decade', () => {
  assert.equal(rowValue(songs[1], 'title'), 'alpha (DJ X)');
  assert.equal(rowValue(songs[0], 'decade'), 1990);
  assert.equal(decadeLabel(songs[2]), '1980s');
  assert.deepEqual(COLUMNS.map(([k]) => k), ['title', 'artist', 'year', 'bpm', 'decade']);
});
