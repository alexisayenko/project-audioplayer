import test from 'node:test';
import assert from 'node:assert/strict';
import { addBody, patchBody, metadataBody, songSources, sourceList, yearValue, yearError } from './song-payload.js';
import { maxYear } from './constants.js';

const v = { title: 'T', artist: 'A', album: 'Al', remixer: 'R', year: '1999', tags: ['x', 'lang:de'], wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, musicbrainz_url: 'https://musicbrainz.org/recording/11111111-2222-3333-4444-555555555555' };

test('addBody has no bpm and no tags', () => {
  assert.deepEqual(addBody(v), { title: 'T', artist: 'A', album: 'Al', remixer: 'R', year: 1999, wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, wikipedia_album: null, musicbrainz_url: v.musicbrainz_url, discogs_url: null, spotify_url: null });
  assert.ok(!('bpm' in addBody(v)) && !('tags' in addBody(v)));
});

test('patchBody keys', () => {
  assert.deepEqual(Object.keys(patchBody(v)).sort(), ['album', 'artist', 'discogs_url', 'musicbrainz_url', 'remixer', 'spotify_url', 'tags', 'title', 'wikipedia_album', 'wikipedia_artist', 'wikipedia_song', 'year']);
  assert.ok(!('remix_year' in patchBody(v)), 'absent from the form values stays absent');
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

test('remix year: add sends it only when non-empty, patch sends null to clear', () => {
  assert.equal(addBody({ ...v, remix_year: '2024' }).remix_year, 2024);
  assert.ok(!('remix_year' in addBody({ ...v, remix_year: '' })));
  assert.equal(patchBody({ ...v, remix_year: '2024' }).remix_year, 2024);
  assert.equal(patchBody({ ...v, remix_year: '' }).remix_year, null);
  assert.equal(patchBody({ ...v, remix_year: '', year: '1999' }).year, 1999);
});

test('years outside 1900..next year are dropped and reported, a stored one is kept', () => {
  const max = new Date().getFullYear() + 1;
  assert.equal(maxYear(), max);
  assert.equal(yearError({ year: String(max) }), null);
  assert.equal(yearError({ year: '1900', remix_year: '' }), null);
  assert.equal(yearError({ year: String(max + 1) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ year: '1899' }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ year: 'x' }) !== null, true);
  assert.equal(yearError({ remix_year: String(max + 1) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ year: String(max + 1) }, { year: max + 1 }), null);
  assert.ok(!('year' in addBody({ ...v, year: String(max + 1) })));
  assert.ok(!('remix_year' in addBody({ ...v, remix_year: '1899' })));
  assert.ok(!('remix_year' in patchBody({ ...v, remix_year: String(max + 5) })));
  assert.equal(patchBody({ ...v, year: String(max + 1) }, { year: max + 1 }).year, max + 1);
  assert.equal(addBody({ ...v, year: String(max) }).year, max);
});

test('wikipedia_album is saved and sent to metadata as wiki_album', () => {
  const w = { ...v, wikipedia_album: 'https://en.wikipedia.org/wiki/Al_(album)' };
  assert.equal(addBody(w).wikipedia_album, w.wikipedia_album);
  assert.equal(patchBody(w).wikipedia_album, w.wikipedia_album);
  assert.equal(metadataBody(w, []).wiki_album, w.wikipedia_album);
  assert.ok(!('wiki_album' in metadataBody(v, [])));
});

test('patchBody sends youtube_url and soundcloud_url only when they differ from the stored link', () => {
  const stored = { id: 'dQw4w9WgXcQ', source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sources: [{ source: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] };
  const same = patchBody({ ...v, youtube_url: stored.source_url, soundcloud_url: null }, stored);
  assert.ok(!('youtube_url' in same) && !('soundcloud_url' in same));
  const edit = patchBody({ ...v, youtube_url: 'https://youtu.be/9bZkp7q19f0', soundcloud_url: 'https://soundcloud.com/a/b', spotify_url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }, stored);
  assert.equal(edit.youtube_url, 'https://youtu.be/9bZkp7q19f0');
  assert.equal(edit.soundcloud_url, 'https://soundcloud.com/a/b');
  assert.equal(edit.spotify_url, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(patchBody({ ...v, youtube_url: '' }, stored).youtube_url, null);
});
