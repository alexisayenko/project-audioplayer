import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const {
  genreRows, totalsOf, sortGenres, filterGenres, nextSort, formatListened, formatPlays, DEFAULT_SORT, genreTag,
} = await import('./stats-genres.js');

const songs = [
  { id: 'a', tags: ['genre:house', 'genre:techno'] },
  { id: 'b', tags: ['genre:house'] },
  { id: 'c', tags: ['genre:drum and bass', 'decade:90s'] },
  { id: 'd', tags: [] },
];
const listening = {
  songs: {
    a: { total_listened_s: 600, listened: { all: 3 } },
    b: { total_listened_s: 7500, listened: { all: 5 } },
  },
};
const by = (rows, key) => rows.find((r) => r.key === key);

test('STA-070: a song with several genres counts in each of them', () => {
  const rows = genreRows(songs, listening);
  assert.equal(rows.length, 3);
  assert.equal(by(rows, 'house').songs, 2);
  assert.equal(by(rows, 'techno').songs, 1);
  assert.equal(by(rows, 'house').listened, 8100);
  assert.equal(by(rows, 'techno').listened, 600);
  assert.equal(by(rows, 'house').plays, 8);
});

test('STA-071: missing listening data counts as 0 and the label comes from the vocabulary', () => {
  const rows = genreRows(songs, null);
  assert.equal(by(rows, 'house').listened, 0);
  assert.equal(by(rows, 'drum and bass').songs, 1);
  assert.equal(by(rows, 'drum and bass').listened, 0);
  assert.equal(genreTag(by(rows, 'house')), 'genre:house');
  assert.equal(genreRows(songs, { songs: { a: { total_listened_s: 'x' } } })[0].listened, 0);
});

test('STA-072: default sort is Total listened descending, unlistened genres last by Songs descending', () => {
  const rows = genreRows([...songs, { id: 'e', tags: ['genre:ambient'] }, { id: 'f', tags: ['genre:ambient'] }], listening);
  const order = sortGenres(rows, DEFAULT_SORT).map((r) => r.key);
  assert.deepEqual(order, ['house', 'techno', 'ambient', 'drum and bass']);
});

test('STA-072: sorting by Genre and Songs, and nextSort toggles the direction', () => {
  const rows = genreRows(songs, listening);
  assert.deepEqual(sortGenres(rows, { key: 'genre', dir: 1 }).map((r) => r.key), ['drum and bass', 'house', 'techno']);
  assert.equal(sortGenres(rows, { key: 'songs', dir: -1 })[0].key, 'house');
  assert.deepEqual(nextSort({ key: 'songs', dir: -1 }, 'songs'), { key: 'songs', dir: 1 });
  assert.deepEqual(nextSort({ key: 'songs', dir: -1 }, 'genre'), { key: 'genre', dir: 1 });
  assert.deepEqual(nextSort({ key: 'genre', dir: 1 }, 'listened'), { key: 'listened', dir: -1 });
});

test('STA-073: filter by genre name', () => {
  const rows = genreRows(songs, listening);
  assert.deepEqual(filterGenres(rows, ' HOU ').map((r) => r.key), ['house']);
  assert.equal(filterGenres(rows, '').length, 3);
  assert.equal(filterGenres(rows, 'zzz').length, 0);
});

test('STA-074: total row counts all songs, also those without genre', () => {
  assert.deepEqual(totalsOf(songs, listening), { songs: 4, listened: 8100, plays: 8 });
  assert.deepEqual(totalsOf([], null), { songs: 0, listened: 0, plays: 0 });
});

test('STA-075: listened time is formatted like the song card', () => {
  assert.equal(formatListened(7500), '2 h 5 min');
  assert.equal(formatListened(720), '12 min');
  assert.equal(formatListened(7200), '2 h');
  assert.equal(formatListened(30), 'under 1 min');
  assert.equal(formatListened(0), '-');
  assert.equal(formatListened(undefined), '-');
  assert.equal(formatPlays(0), '-');
  assert.equal(formatPlays(8), '8');
});
