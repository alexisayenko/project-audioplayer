import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNamespaced, planMetadata, statusText, serviceState, suggestion, suggestionText, countryCode } from './metadata-apply.js';

test('fills only empty album and year', () => {
  const r = { album: 'A', year: 1999, tags: [] };
  assert.deepEqual(planMetadata(r, { album: '', year: '', tags: [] }), { album: 'A', year: 1999, tags: [], status: 'filled' });
  const p = planMetadata(r, { album: 'Mine', year: '2001', tags: [] });
  assert.equal(p.album, null);
  assert.equal(p.year, null);
  assert.equal(p.status, 'current');
  assert.equal(statusText(p), 'Already up to date');
});

test('empty and tolerant responses', () => {
  for (const r of [null, {}, { tags: 'x', year: '1' }, { tags: ['lang:ru', 'mood:calm'] }]) {
    const p = planMetadata(r, { album: '', year: '', tags: [] });
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
  const p = planMetadata({ tags: ['genre:pop', 'lang:ru'] }, { album: '', year: '', tags: ['genre:pop'] });
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
  assert.equal(s.discogs.on, false);
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
  assert.equal(planMetadata(r, { album: 'A', year: '', tags: [], wikipedia_album: null }).wikipedia_album, r.wikipedia_album);
  assert.equal(planMetadata(r, { album: 'A', year: '', tags: [], wikipedia_album: null }).status, 'filled');
  assert.equal(planMetadata(r, { album: 'A', year: '', tags: [], wikipedia_album: 'https://en.wikipedia.org/wiki/Mine' }).wikipedia_album, undefined);
  assert.equal(planMetadata({ wikipedia_album: 'javascript:x' }, { album: '', year: '', tags: [] }).wikipedia_album, undefined);
});
