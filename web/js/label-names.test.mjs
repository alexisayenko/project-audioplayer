import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { cleanLabels, labelsOf, sameLabels, labelsCaption, LABEL_LIMIT, LABEL_LENGTH } = await import('./label-names.js');
const { libraryLabels, noteAlbums } = await import('./label-suggest.js');
const { store } = await import('./store.js');
const { songMatches } = await import('./song-match.js');
const { matchesQuery } = await import('./albums-model.js');

test('cleanLabels trims, collapses spaces, drops duplicates ignoring case and junk', () => {
  assert.deepEqual(cleanLabels(['  Parvati   Records ', 'parvati records', '', '  ', null, 5, 'Iono\tMusic']), ['Parvati Records', 'Iono Music']);
  assert.deepEqual(cleanLabels('Parvati'), []);
  assert.deepEqual(cleanLabels(undefined), []);
});

test('cleanLabels keeps at most ten names and cuts a name at 100 characters', () => {
  assert.equal(cleanLabels(Array.from({ length: 30 }, (_, i) => `L${i}`)).length, LABEL_LIMIT);
  assert.equal(cleanLabels(['x'.repeat(300)])[0].length, LABEL_LENGTH);
});

test('labelsOf reads a record and sameLabels ignores spacing but not spelling', () => {
  assert.deepEqual(labelsOf({ labels: [' A ', 'b'] }), ['A', 'b']);
  assert.deepEqual(labelsOf({}), []);
  assert.deepEqual(labelsOf(null), []);
  assert.equal(sameLabels(['A', 'b'], [' a ', 'B']), false, 'a changed capital letter is a change');
  assert.equal(sameLabels(['A b'], [' A   b ']), true);
  assert.equal(sameLabels([], undefined), true);
});

test('labelsCaption says Label or Labels, or nothing', () => {
  assert.equal(labelsCaption({ labels: ['Parvati Records'] }), 'Label: Parvati Records');
  assert.equal(labelsCaption({ labels: ['Blue Room Released', 'Phonokol'] }), 'Labels: Blue Room Released, Phonokol');
  assert.equal(labelsCaption({}), '');
});

test('libraryLabels lists the labels of songs and noted albums, most used first', () => {
  store.songs = [{ id: 'a', labels: ['Iono Music', 'Parvati Records'] }, { id: 'b', labels: ['parvati records'] }, { id: 'c' }];
  noteAlbums([{ labels: ['Phonokol'] }, { labels: ['Iono Music'] }]);
  assert.deepEqual(libraryLabels(), ['Iono Music', 'Parvati Records', 'Phonokol']);
  noteAlbums(null);
  store.songs = [];
  assert.deepEqual(libraryLabels(), []);
});

test('the Library search finds a song by its label, not only by title', () => {
  const song = { id: 'a', title: 'Song', mainArtists: ['Band'], featuredArtists: [], tags: [], labels: ['Parvati Records'] };
  assert.equal(songMatches(song, 'parvati'), true);
  assert.equal(songMatches(song, 'Parvati Records'), true);
  assert.equal(songMatches({ ...song, labels: [] }, 'parvati'), false);
  assert.equal(songMatches({ ...song, labels: undefined }, 'parvati'), false);
});

test('the album search finds an album by its label', () => {
  const album = { title: 'Total Eclipse', artist: 'Delta', genres: [], tracks: [], labels: ['Blue Room Released'] };
  assert.equal(matchesQuery(album, 'blue room'), true);
  assert.equal(matchesQuery({ ...album, labels: [] }, 'blue room'), false);
  assert.equal(matchesQuery({ ...album, labels: undefined }, 'blue room'), false);
});
