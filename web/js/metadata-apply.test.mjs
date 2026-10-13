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
  const s = serviceState({ youtube: { found: true, url: 'https://y.example/x' }, soundcloud: { found: true, url: null }, wikipedia: { found: false, url: 'https://w' }, spotify: { found: true, url: 'https://s' } });
  assert.deepEqual(s.youtube, { on: true, url: 'https://y.example/x' });
  assert.deepEqual(s.soundcloud, { on: true, url: null });
  assert.equal(s.wikipedia.on, false);
  assert.equal(s.spotify.on, false);
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
