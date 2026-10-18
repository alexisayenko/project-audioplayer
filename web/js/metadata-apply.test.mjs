import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNamespaced, planMetadata, statusText, discogsNote, metaMessage, serviceState, suggestion, suggestionText, countryCode } from './metadata-apply.js';

test('fills only empty album and first released', () => {
  const r = { album: 'A', year: 1999, tags: [] };
  assert.deepEqual(planMetadata(r, { album: '', released: '', tags: [] }), { album: 'A', released: 1999, tags: [], status: 'filled' });
  const p = planMetadata(r, { album: 'Mine', released: '2001', tags: [] });
  assert.equal(p.album, null);
  assert.equal(p.released, null);
  assert.equal(p.status, 'current');
  assert.equal(statusText(p), 'Already up to date');
});

test('empty and tolerant responses', () => {
  for (const r of [null, {}, { tags: 'x', year: '1' }, { tags: ['lang:ru', 'mood:calm'] }]) {
    const p = planMetadata(r, { album: '', released: '', tags: [] });
    assert.equal(p.status, 'empty');
    assert.equal(statusText(p), 'Nothing found');
  }
});

test('adds genre and country tags within caps, never lang', () => {
  const have = ['genre:rock', 'country:lt'];
  assert.deepEqual(addNamespaced(have, ['genre:Rock', 'genre:pop', 'country:de', 'lang:ru', 'mood:x', 'genre:']), ['genre:pop']);
  const twelve = Array.from({ length: 12 }, (_, i) => `genre:g${i}`);
  assert.deepEqual(addNamespaced(twelve, ['genre:new']), []);
  assert.deepEqual(addNamespaced([], ['country:lt', 'country:de', 'genre:a', 'genre:a']), ['country:lt', 'genre:a']);
  const p = planMetadata({ tags: ['genre:pop', 'lang:ru'] }, { album: '', released: '', tags: ['genre:pop'] });
  assert.equal(p.status, 'current');
});

test('services', () => {
  const s = serviceState({ youtube: { found: true, url: 'https://y.example/x' }, soundcloud: { found: true, url: null }, wikipedia: { found: false, url: 'https://w' }, spotify: { found: true, url: 'https://s' }, musicbrainz: { found: true, url: 'https://m' }, discogs: { found: true, url: 'https://d' } });
  assert.deepEqual(s.youtube, { on: true, url: 'https://y.example/x' });
  assert.deepEqual(s.soundcloud, { on: true, url: null });
  assert.equal(s.wikipedia.on, false);
  assert.equal(s.spotify.on, false);
  assert.deepEqual(s.musicbrainz, { on: true, url: 'https://m' });
  assert.equal(serviceState({ musicbrainz: { found: false, url: null } }).musicbrainz.on, false);
  assert.deepEqual(s.discogs, { on: true, url: 'https://d' });
  assert.equal(serviceState({ discogs: { found: true, url: 'https://d', from_link: true } }).discogs.fromLink, true);
  assert.equal(serviceState({ discogs: { found: false, url: null, skipped: 'no_match' } }).discogs.skipped, 'no_match');
  assert.equal(serviceState(undefined).youtube.on, false);
  assert.equal(serviceState({ youtube: { found: true, url: 'javascript:alert(1)' } }).youtube.url, null);
});

test('suggestion', () => {
  assert.equal(suggestion(undefined, { artist: 'a', title: 't' }), null);
  assert.equal(suggestion({ artist: ' A ', title: 'T' }, { artist: 'a', title: ' t' }), null);
  assert.deepEqual(suggestion({ artist: 'Abba', title: null }, { artist: 'abb', title: 'x' }), { artist: 'Abba' });
  assert.equal(suggestionText({ artist: 'Abba' }, { artist: 'abb', title: 'x' }), 'Abba / x');
});

test('countryCode', () => {
  assert.equal(countryCode('LT'), 'lt');
  assert.equal(countryCode('lithuania'), 'lt');
  assert.equal(countryCode('Atlantis'), null);
  assert.equal(countryCode(''), null);
  console.log('metadata-apply tests passed');
});

test('countryCode accepts historical su', () => {
  assert.equal(countryCode('su'), 'su');
  assert.equal(countryCode('USSR'), 'su');
  assert.equal(countryCode('Atlantis'), null);
});

test('planMetadata fills an empty wikipedia_album link only from an https link', () => {
  const r = { album: 'A', wikipedia_album: 'https://en.wikipedia.org/wiki/A_(album)' };
  assert.equal(planMetadata(r, { album: 'A', released: '', tags: [], wikipedia_album: null }).wikipedia_album, r.wikipedia_album);
  assert.equal(planMetadata(r, { album: 'A', released: '', tags: [], wikipedia_album: null }).status, 'filled');
  assert.equal(planMetadata(r, { album: 'A', released: '', tags: [], wikipedia_album: 'https://en.wikipedia.org/wiki/Mine' }).wikipedia_album, undefined);
  assert.equal(planMetadata({ wikipedia_album: 'javascript:x' }, { album: '', released: '', tags: [] }).wikipedia_album, undefined);
});

test('planMetadata fills empty song and band wikipedia links only', () => {
  const r = { wikipedia_song: 'https://en.wikipedia.org/wiki/What_Is_Love', wikipedia_artist: 'https://en.wikipedia.org/wiki/Haddaway' };
  const p = planMetadata(r, { album: '', released: '', tags: [], wikipedia_song: '', wikipedia_artist: 'https://en.wikipedia.org/wiki/Mine' });
  assert.equal(p.wikipedia_song, r.wikipedia_song);
  assert.equal(p.wikipedia_artist, undefined);
  assert.equal(p.status, 'filled');
});

test('a song with a version never takes the album of the original recording', () => {
  const r = { album: 'A', year: 1999, tags: [] };
  const p = planMetadata(r, { album: '', released: '', tags: [], versioned: true });
  assert.equal(p.album, null);
  assert.equal(p.released, 1999);
});

test('discogs note names the link or the reason Discogs was skipped', () => {
  assert.equal(discogsNote({ on: true, fromLink: true }), 'Discogs: from link');
  assert.equal(discogsNote({ on: false, skipped: 'not_configured' }), 'Discogs: not configured on the server');
  assert.equal(discogsNote({ on: false, skipped: 'no_match' }), 'Discogs: no match');
  assert.equal(discogsNote({ on: false, skipped: 'error' }), 'Discogs: lookup failed');
  assert.equal(discogsNote({ on: true, url: 'https://d' }), '');
  assert.equal(discogsNote(null), '');
  assert.equal(metaMessage({ status: 'current' }, { skipped: 'no_match' }), 'Already up to date. Discogs: no match');
  assert.equal(metaMessage({ status: 'filled' }, { fromLink: true }), 'Discogs: from link');
  assert.equal(metaMessage({ status: 'empty' }, null), 'Nothing found');
});
