import test from 'node:test';
import assert from 'node:assert/strict';
import { addBody, patchBody, metadataBody, songSources, sourceList, yearValue } from './song-payload.js';

const v = { title: 'T', artist: 'A', album: 'Al', remixer: 'R', year: '1999', tags: ['x', 'lang:de'], wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, musicbrainz_url: 'https://musicbrainz.org/recording/11111111-2222-3333-4444-555555555555' };

test('addBody has no bpm and no tags', () => {
  assert.deepEqual(addBody(v), { title: 'T', artist: 'A', album: 'Al', remixer: 'R', year: 1999, wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, musicbrainz_url: v.musicbrainz_url, discogs_url: null });
  assert.ok(!('bpm' in addBody(v)) && !('tags' in addBody(v)));
});

test('patchBody keys', () => {
  assert.deepEqual(Object.keys(patchBody(v)).sort(), ['album', 'artist', 'discogs_url', 'musicbrainz_url', 'remixer', 'tags', 'title', 'wikipedia_artist', 'wikipedia_song', 'year']);
  assert.deepEqual(patchBody(v).tags, ['x', 'lang:de']);
});

test('absent musicbrainz_url is sent as null', () => {
  assert.equal(addBody({ ...v, musicbrainz_url: undefined }).musicbrainz_url, null);
});

test('discogs_url is sent when set and as null when absent', () => {
  assert.equal(addBody({ ...v, discogs_url: 'https://www.discogs.com/release/1' }).discogs_url, 'https://www.discogs.com/release/1');
  assert.equal(patchBody(v).discogs_url, null);
});

test('empty year is null', () => {
  assert.equal(yearValue(''), null);
  assert.equal(patchBody({ ...v, year: '' }).year, null);
});

test('metadataBody trims, adds wiki keys only when set', () => {
  assert.deepEqual(metadataBody({ title: ' T ', artist: ' ', wikipedia_song: 'u' }, 'https://y/1'), { title: 'T', artist: '', sources: [{ url: 'https://y/1' }], wiki_song: 'u' });
});

test('songSources merges sources and source_url without duplicates', () => {
  assert.deepEqual(songSources({ sources: [{ url: 'a' }, { url: 'b' }], source_url: 'a' }), [{ url: 'a' }, { url: 'b' }]);
  assert.deepEqual(songSources({ source_url: 'c' }), [{ url: 'c' }]);
  assert.deepEqual(songSources({}), []);
  assert.deepEqual(sourceList(null), []);
});

test('titles with commas and Cyrillic are saved verbatim', () => {
  for (const title of ['Лондон, гуд бай', 'Hello, World - Part 2', '1,000 Ways; Again', 'A / B, C']) {
    assert.equal(patchBody({ ...v, title }).title, title);
    assert.equal(addBody({ ...v, title }).title, title);
  }
});

test('multi-artist strings are saved verbatim', () => {
  for (const artist of ['A, B', 'CarMan', 'Sadrican, DJ Harley Q., GOLDFISH', 'Земфира, Би-2']) {
    assert.equal(patchBody({ ...v, artist }).artist, artist);
  }
});
