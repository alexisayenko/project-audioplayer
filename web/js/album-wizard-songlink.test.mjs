import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
const M = await import('./album-wizard-model.js');
const L = await import('./album-wizard-songlink.js');
const { VIDEO, PLAYLIST } = await import('./album-wizard-fixture.mjs');

const song = (id, title, artists, extra = {}) => ({ id, title, mainArtists: artists, featuredArtists: [], withArtists: [], version: null, ...extra });
const LIB = [
  song('s1', 'Spirit Guide', ['Hallucinogen'], { added_at: '2026-01-01' }),
  song('s2', 'Café del Mar', ['Energy 52'], { added_at: '2026-03-01' }),
  song('s3', 'LSD Dreams', ['Someone Else'], { added_at: '2026-02-01' }),
  song('s4', 'Lsd', ['Hallucinogen'], { added_at: '2026-04-01' }),
];

const make = (kind = 'video') => {
  const d = M.newDraft();
  d.address = 'https://youtu.be/yeUFSnA9Puk';
  M.applyPreview(d, kind, d.address, kind === 'video' ? VIDEO : PLAYLIST);
  M.buildReview(d);
  return d;
};
const keyOf = (d, i) => d.st.rows[i].key;
const sent = (d) => M.createPayload(d).tracks.map((t) => t.useExistingSongId);

test('search is a normalised substring over artist and title, best title first, at most eight', () => {
  assert.deepEqual(L.searchSongs(LIB, 'cafe').map((s) => s.id), ['s2']);
  assert.deepEqual(L.searchSongs(LIB, 'ENERGY  52 café').map((s) => s.id), ['s2']);
  assert.deepEqual(L.searchSongs(LIB, 'lsd').map((s) => s.id), ['s4', 's3']);
  assert.deepEqual(L.searchSongs(LIB, 'hallucinogen lsd').map((s) => s.id), ['s4']);
  assert.deepEqual(L.searchSongs(LIB, 'zzz'), []);
  const many = Array.from({ length: 20 }, (_, i) => song(`m${i}`, `Track ${i}`, ['Many']));
  assert.equal(L.searchSongs(many, 'track').length, L.LINK_LIMIT);
  assert.equal(L.searchSongs(null, 'x').length, 0);
});

test('an empty search lists the newest songs first', () => {
  assert.deepEqual(L.searchSongs(LIB, '  ').map((s) => s.id), ['s4', 's2', 's3', 's1']);
});

test('linking an unmatched row ticks it, marks Use existing and sends the song id', () => {
  const d = make();
  assert.deepEqual(sent(d), [null, null, null]);
  assert.equal(L.linkSong(d, keyOf(d, 0), LIB[1]), true);
  const st = d.review.state.get(keyOf(d, 0));
  assert.deepEqual([st.include, st.useExisting, st.link.songId, st.link.manual], [true, true, 's2', true]);
  assert.equal(L.linkText(st.link), 'Energy 52 - Café del Mar');
  const body = M.createPayload(d);
  assert.deepEqual(body.tracks.map((t) => [t.include, t.useExistingSongId]), [[true, 's2'], [false, null], [true, null]]);
});

test('a manual link replaces the detected match; unlinking returns to it, unticked', () => {
  const d = make();
  const key = keyOf(d, 1);
  assert.equal(L.effectiveMatch(d.st.rows[1], d.review.state.get(key)).songId, 's9');
  L.linkSong(d, key, LIB[0]);
  assert.deepEqual(sent(d)[1], 's1');
  L.unlinkSong(d, key);
  const st = d.review.state.get(key);
  assert.deepEqual([st.include, st.useExisting, st.link], [false, false, null]);
  assert.equal(L.effectiveMatch(d.st.rows[1], st).songId, 's9');
  assert.deepEqual(sent(d), [null, null, null]);
});

test('a song belongs to one row: linking it again moves it and unticks the old row', () => {
  const d = make();
  L.linkSong(d, keyOf(d, 0), LIB[0]);
  assert.equal(L.usedFor(d, 's1', keyOf(d, 2)), 1);
  assert.equal(L.usedFor(d, 's1', keyOf(d, 0)), null);
  assert.equal(L.usedFor(d, 's2'), null);
  L.linkSong(d, keyOf(d, 2), LIB[0]);
  const first = d.review.state.get(keyOf(d, 0));
  assert.deepEqual([first.include, first.useExisting, first.link], [false, false, null]);
  assert.deepEqual(sent(d), [null, null, 's1']);
  assert.equal(L.usedFor(d, 's1', keyOf(d, 0)), 1);
  assert.equal(M.createPayload(d).tracks[2].trackNo, 1);
});

test('a detected match that is ticked as Use existing also counts as taken', () => {
  const d = make();
  const key = keyOf(d, 1);
  assert.equal(L.usedFor(d, 's9'), null);
  d.review.state.get(key).include = true;
  d.review.state.get(key).useExisting = true;
  assert.equal(L.usedFor(d, 's9', keyOf(d, 0)), 2);
  L.linkSong(d, keyOf(d, 0), song('s9', 'Spirit Guide', ['Hallucinogen']));
  assert.equal(d.review.state.get(key).useExisting, false);
  assert.deepEqual(sent(d), ['s9', null, null]);
});

test('clearing links drops every manual link and every Use existing', () => {
  const d = make();
  L.linkSong(d, keyOf(d, 0), LIB[0]);
  d.review.state.get(keyOf(d, 1)).useExisting = true;
  L.clearLinks(d);
  assert.deepEqual(sent(d), [null, null, null]);
  assert.equal([...d.review.state.values()].every((s) => s.link === null && !s.useExisting), true);
});

test('a playlist row linked to a library song sends useExistingSongId and is not counted as a download', () => {
  const d = make('playlist');
  assert.equal(M.downloadCount(d), 2);
  assert.equal(M.createLabel(d), 'Import and download 2 tracks');
  L.linkSong(d, keyOf(d, 2), LIB[2]);
  assert.equal(M.downloadCount(d), 1);
  const picked = M.createPayload(d).selected;
  assert.deepEqual(picked.map((s) => [s.position, s.useExistingSongId]), [[1, undefined], [2, undefined], [3, 's3']]);
  assert.equal(M.createLabel(d), 'Import and download 1 track');
});

test('a playlist row already in the library keeps its own song and takes no link key', () => {
  const d = make('playlist');
  const key = keyOf(d, 1);
  assert.equal(d.st.rows[1].songId, 's1');
  d.review.state.get(key).include = true;
  assert.equal('useExistingSongId' in M.createPayload(d).selected.find((s) => s.position === 2), false);
});
