import test from 'node:test';
import assert from 'node:assert/strict';
import { addBody, patchBody, metadataBody, songSources, sourceList, yearValue, yearError, artistString } from './song-payload.js';
import { maxYear } from './constants.js';

const v = { title: 'T', artists: ['A'], featured: [], released: '1999', version: null, album: 'Al', tags: ['x', 'lang:de'], wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, musicbrainz_url: 'https://musicbrainz.org/recording/11111111-2222-3333-4444-555555555555' };
const LEGACY = ['artist', 'remixer', 'year', 'remix_year'];

test('addBody sends the structure, no legacy key, no bpm, no tags, no version when none', () => {
  assert.deepEqual(addBody(v), { title: 'T', album: 'Al', artists: ['A'], featured: [], released: 1999, wikipedia_song: 'https://en.wikipedia.org/wiki/T', wikipedia_artist: null, wikipedia_album: null, musicbrainz_url: v.musicbrainz_url, discogs_url: null, spotify_url: null });
  for (const k of [...LEGACY, 'bpm', 'tags', 'version']) assert.ok(!(k in addBody(v)), k);
});

test('patchBody keys: structure only, version null removes it', () => {
  assert.deepEqual(Object.keys(patchBody(v)).sort(), ['album', 'artists', 'discogs_url', 'featured', 'musicbrainz_url', 'released', 'spotify_url', 'tags', 'title', 'version', 'wikipedia_album', 'wikipedia_artist', 'wikipedia_song']);
  assert.equal(patchBody(v).version, null);
  for (const k of LEGACY) assert.ok(!(k in patchBody(v)), k);
  assert.deepEqual(patchBody(v).tags, ['x', 'lang:de']);
});

test('version object: kind, name, by, year; of only for a cover; blank text is null', () => {
  const ver = { kind: 'remix', name: ' Alesso Remix ', by: [' Alesso ', ''], year: '2012', of: 'ignored' };
  assert.deepEqual(addBody({ ...v, version: ver }).version, { kind: 'remix', name: 'Alesso Remix', by: ['Alesso'], year: 2012 });
  assert.deepEqual(patchBody({ ...v, version: { kind: 'cover', name: '', by: [], year: '', of: ' Artist A ' } }).version, { kind: 'cover', name: null, by: [], year: null, of: ['Artist A'] });
  assert.deepEqual(patchBody({ ...v, version: { kind: 'mashup', name: '', by: [], year: '', of: [' S1 ', '', 'S2'] } }).version.of, ['S1', 'S2']);
  assert.equal(patchBody({ ...v, version: { kind: '', name: 'x' } }).version, null);
});

test('artists and featured are trimmed lists', () => {
  const b = addBody({ ...v, artists: [' A ', '', 'B'], featured: ['C'] });
  assert.deepEqual(b.artists, ['A', 'B']);
  assert.deepEqual(b.featured, ['C']);
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
  assert.equal(patchBody({ ...v, released: '' }).released, null);
});

test('metadataBody sends the display artist string, version_kind, trims, adds wiki keys only when set', () => {
  assert.deepEqual(metadataBody({ title: ' T ', artists: [], wikipedia_song: 'u' }, 'https://y/1'), { title: 'T', artist: '', sources: [{ url: 'https://y/1' }], wiki_song: 'u' });
  assert.deepEqual(metadataBody({ title: 'T', artists: ['A', 'B'], featured: ['C'], version: { kind: 'live' } }, []), { title: 'T', artist: 'A & B feat. C', version_kind: 'live', sources: [] });
  assert.equal(metadataBody({ title: 'T', artists: ['A', 'B', 'C'], version: null }, []).artist, 'A, B & C');
  assert.ok(!('version_kind' in metadataBody({ title: 'T', artists: ['A'] }, [])));
  assert.equal(artistString({ artists: ['Solo'] }), 'Solo');
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
    assert.deepEqual(patchBody({ ...v, artists }).artists, artists);
  }
});

test('version year: add sends it inside version, patch sends null to clear', () => {
  const ver = (year) => ({ kind: 'remix', name: 'R', by: [], year });
  assert.equal(addBody({ ...v, version: ver('2024') }).version.year, 2024);
  assert.equal(addBody({ ...v, version: ver('') }).version.year, null);
  assert.equal(patchBody({ ...v, version: ver('2024') }).version.year, 2024);
  assert.equal(patchBody({ ...v, version: ver('') }).version.year, null);
  assert.equal(patchBody({ ...v, version: ver(''), released: '1999' }).released, 1999);
});

test('years outside 1900..next year are dropped and reported, a stored one is kept', () => {
  const max = new Date().getFullYear() + 1;
  const ver = (year) => ({ kind: 'remix', year });
  assert.equal(maxYear(), max);
  assert.equal(yearError({ released: String(max) }), null);
  assert.equal(yearError({ released: '1900', version: ver('') }), null);
  assert.equal(yearError({ released: String(max + 1) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ released: '1899' }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ released: 'x' }) !== null, true);
  assert.equal(yearError({ version: ver(String(max + 1)) }), `Enter a year from 1900 to ${max}`);
  assert.equal(yearError({ released: String(max + 1) }, { released: max + 1 }), null);
  assert.equal(yearError({ released: String(max + 1) }, { year: max + 1 }), null, 'a legacy stored song counts');
  assert.equal(yearError({ version: ver(String(max + 1)) }, { version: { year: max + 1 } }), null);
  assert.ok(!('released' in addBody({ ...v, released: String(max + 1) })));
  assert.equal(addBody({ ...v, version: ver('1899') }).version.year, null);
  assert.equal(patchBody({ ...v, version: ver(String(max + 5)) }).version.year, null);
  assert.equal(patchBody({ ...v, released: String(max + 1) }, { released: max + 1 }).released, max + 1);
  assert.equal(addBody({ ...v, released: String(max) }).released, max);
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
