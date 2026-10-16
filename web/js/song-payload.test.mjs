import test from 'node:test';
import assert from 'node:assert/strict';
import { addBody, patchBody, metadataBody, songSources, sourceList, yearValue, yearError, artistString } from './song-payload.js';
import { maxYear } from './constants.js';

const v = { title: 'T', mainArtists: ['A'], featuredArtists: [], releaseYear: '1999', version: null, albums: ['Al'], tags: ['x', 'lang:de', 'decade:90s', 'country:de'], wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, musicbrainz_url: 'https://musicbrainz.org/recording/11111111-2222-3333-4444-555555555555' };
const LEGACY = ['artist', 'remixer', 'year', 'remix_year'];

test('addBody sends the structure, no legacy key, no bpm, no tags, no version when none', () => {
  assert.deepEqual(addBody(v), { title: 'T', albums: ['Al'], mainArtists: ['A'], featuredArtists: [], releaseYear: 1999, wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, wikipedia_album: null, musicbrainz_url: v.musicbrainz_url, discogs_url: null, spotify_url: null });
  for (const k of [...LEGACY, 'bpm', 'tags', 'version']) assert.ok(!(k in addBody(v)), k);
});

test('patchBody keys: structure only, version null removes it', () => {
  assert.deepEqual(Object.keys(patchBody(v)).sort(), ['albums', 'discogs_url', 'featuredArtists', 'genres', 'mainArtists', 'musicbrainz_url', 'releaseYear', 'spotify_url', 'tags', 'title', 'version', 'wikipedia_album', 'wikipedia_artist', 'wikipedia_song']);
  assert.equal(patchBody(v).version, null);
  for (const k of LEGACY) assert.ok(!(k in patchBody(v)), k);
  assert.deepEqual(patchBody(v).tags, ['x', 'country:de'], 'decade and lang tags are never sent, genres travel in genres');
  assert.deepEqual(patchBody({ ...v, tags: ['genre:House', 'x', 'genre:'] }).genres, ['House']);
});

test('version object: type, name, artists, releaseYear; originalArtists only for a cover; blank text is null', () => {
  const ver = { type: 'remix', name: ' Alesso Remix ', artists: [' Alesso ', ''], releaseYear: '2012', originalArtists: 'ignored' };
  assert.deepEqual(addBody({ ...v, version: ver }).version, { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'], releaseYear: 2012 });
  assert.deepEqual(patchBody({ ...v, version: { type: 'cover', name: '', artists: [], releaseYear: '', originalArtists: ' Artist A ' } }).version, { type: 'cover', name: null, artists: [], releaseYear: null, originalArtists: ['Artist A'] });
  assert.deepEqual(patchBody({ ...v, version: { type: 'mashup', name: '', artists: [], releaseYear: '', originalArtists: [' S1 ', '', 'S2'] } }).version.originalArtists, ['S1', 'S2']);
  assert.equal(patchBody({ ...v, version: { type: '', name: 'x' } }).version, null);
});

test('artists and featured are trimmed lists', () => {
  const b = addBody({ ...v, mainArtists: [' A ', '', 'B'], featuredArtists: ['C'] });
  assert.deepEqual(b.mainArtists, ['A', 'B']);
  assert.deepEqual(b.featuredArtists, ['C']);
});

test('absent musicbrainz_url is sent as null', () => {
  assert.equal(addBody({ ...v, musicbrainz_url: undefined }).musicbrainz_url, null);
});

test('discogs_url is sent when set and as null when absent', () => {
  assert.equal(addBody({ ...v, discogs_url: 'https://www.discogs.com/release/1' }).discogs_url, 'https://www.discogs.com/release/1');
  assert.equal(patchBody(v).discogs_url, null);
});

test('empty released is null', () => {
  assert.equal(yearValue(''), null);
  assert.equal(patchBody({ ...v, releaseYear: '' }).releaseYear, null);
});

test('metadataBody sends the display artist string, version_kind, trims, adds wiki keys only when set', () => {
  assert.deepEqual(metadataBody({ title: ' T ', mainArtists: [], wikipedia_song: 'u' }, 'https://y/1'), { title: 'T', artist: '', sources: [{ url: 'https://y/1' }], wiki_song: 'u' });
  assert.deepEqual(metadataBody({ title: 'T', mainArtists: ['A', 'B'], featuredArtists: ['C'], version: { type: 'live' } }, []), { title: 'T', artist: 'A & B feat. C', version_kind: 'live', sources: [] });
  assert.equal(metadataBody({ title: 'T', mainArtists: ['A', 'B', 'C'], version: null }, []).artist, 'A, B & C');
  assert.ok(!('version_kind' in metadataBody({ title: 'T', mainArtists: ['A'] }, [])));
  assert.equal(artistString({ mainArtists: ['Solo'] }), 'Solo');
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

test('artist names with commas and ampersands are kept as one entry', () => {
  for (const artists of [['A, B'], ['Nadia Ali, Starkillers & Alex Kenji'], ['Земфира', 'Би-2']]) {
    assert.deepEqual(patchBody({ ...v, mainArtists: artists }).mainArtists, artists);
  }
});

test('version year: add sends it inside version, patch sends null to clear', () => {
  const ver = (year) => ({ type: 'remix', name: 'R', artists: [], releaseYear: year });
  assert.equal(addBody({ ...v, version: ver('2024') }).version.releaseYear, 2024);
  assert.equal(addBody({ ...v, version: ver('') }).version.releaseYear, null);
  assert.equal(patchBody({ ...v, version: ver('2024') }).version.releaseYear, 2024);
  assert.equal(patchBody({ ...v, version: ver('') }).version.releaseYear, null);
  assert.equal(patchBody({ ...v, version: ver(''), releaseYear: '1999' }).releaseYear, 1999);
});

test('years outside 1900..next year are dropped and reported, a stored one is kept', () => {
  const max = new Date().getFullYear() + 1;
  const ver = (year) => ({ type: 'remix', releaseYear: year });
  assert.equal(maxYear(), max);
  assert.equal(yearError({ releaseYear: String(max) }), null);
  assert.equal(yearError({ releaseYear: '1900', version: ver('') }), null);
  assert.equal(yearError({ releaseYear: String(max + 1) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ releaseYear: '1899' }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ releaseYear: 'x' }) !== null, true);
  assert.equal(yearError({ version: ver(String(max + 1)) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ releaseYear: String(max + 1) }, { releaseYear: max + 1 }), null);
  assert.equal(yearError({ releaseYear: String(max + 1) }, { year: max + 1 }), null, 'a legacy stored song counts');
  assert.equal(yearError({ version: ver(String(max + 1)) }, { version: { releaseYear: max + 1 } }), null);
  assert.ok(!('releaseYear' in addBody({ ...v, releaseYear: String(max + 1) })));
  assert.equal(addBody({ ...v, version: ver('1899') }).version.releaseYear, null);
  assert.equal(patchBody({ ...v, version: ver(String(max + 5)) }).version.releaseYear, null);
  assert.equal(patchBody({ ...v, releaseYear: String(max + 1) }, { releaseYear: max + 1 }).releaseYear, max + 1);
  assert.equal(addBody({ ...v, releaseYear: String(max) }).releaseYear, max);
});

test('requests carry only the v2 names, never the ADR-0024 or flat legacy ones', () => {
  const ver = { type: 'cover', name: 'N', artists: ['X'], releaseYear: '2020', originalArtists: ['Y'] };
  for (const b of [addBody({ ...v, version: ver }), patchBody({ ...v, version: ver })]) {
    for (const k of ['artists', 'featured', 'released', 'album', 'raw', ...LEGACY]) assert.ok(!(k in b), k);
    for (const k of ['kind', 'by', 'year', 'of']) assert.ok(!(k in b.version), k);
    assert.deepEqual(Object.keys(b.version).sort(), ['artists', 'name', 'originalArtists', 'releaseYear', 'type']);
  }
});

test('albums are trimmed and blank ones dropped', () => {
  assert.deepEqual(addBody({ ...v, albums: [' LP ', '', 'Reissue'] }).albums, ['LP', 'Reissue']);
  assert.deepEqual(addBody({ ...v, albums: undefined }).albums, []);
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
