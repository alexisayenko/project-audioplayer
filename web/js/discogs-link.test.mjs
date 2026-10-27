import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscogsLink, NOT_DISCOGS_LINK } from './discogs-link.js';

const ok = (kind, id) => ({ ok: true, kind, id });
const bad = { ok: false, error: NOT_DISCOGS_LINK };

test('a master or release address gives its kind and number', () => {
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/master/123-Some-Title'), ok('master', 123));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/release/545650-Derango-Tumult'), ok('release', 545650));
  assert.deepEqual(parseDiscogsLink('https://discogs.com/master/7'), ok('master', 7));
  assert.deepEqual(parseDiscogsLink('http://www.discogs.com/release/9/'), ok('release', 9));
  assert.deepEqual(parseDiscogsLink('  https://www.discogs.com/master/123-Title  '), ok('master', 123));
});

test('a language prefix, a query and a fragment are ignored', () => {
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/en/master/55-Title'), ok('master', 55));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/de/release/66-Titel?ev=rb#tracklist'), ok('release', 66));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/pt-BR/release/77'), ok('release', 77));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/master/88?utm_source=x'), ok('master', 88));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/release/99#x'), ok('release', 99));
  assert.deepEqual(parseDiscogsLink('https://www.discogs.com/master/view/12'), ok('master', 12));
});

test('an address without a scheme, the API address and the short forms work', () => {
  assert.deepEqual(parseDiscogsLink('discogs.com/master/5-T'), ok('master', 5));
  assert.deepEqual(parseDiscogsLink('www.discogs.com/release/6'), ok('release', 6));
  assert.deepEqual(parseDiscogsLink('https://api.discogs.com/releases/123'), ok('release', 123));
  assert.deepEqual(parseDiscogsLink('https://api.discogs.com/masters/456'), ok('master', 456));
  assert.deepEqual(parseDiscogsLink('r123'), ok('release', 123));
  assert.deepEqual(parseDiscogsLink('M45'), ok('master', 45));
});

test('anything else is not a Discogs release or master link', () => {
  for (const text of [
    '', '   ', 'hello', 'r', 'x123', 'r12a',
    'https://www.discogs.com/artist/123-Someone',
    'https://www.discogs.com/label/5-Label',
    'https://www.discogs.com/release/abc',
    'https://www.discogs.com/release/',
    'https://www.discogs.com/release/0',
    'https://www.discogs.com/master/-5',
    'https://www.discogs.com/',
    'https://discogs.com.evil.com/release/123',
    'https://notdiscogs.com/release/123',
    'https://example.com/release/123',
    'https://evil.com/?u=https://www.discogs.com/release/123',
    'https://api.discogs.com/artists/123',
    'ftp://www.discogs.com/release/123',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=yeUFSnA9Puk',
    'https://www.discogs.com/release/99999999999999999999',
  ]) assert.deepEqual(parseDiscogsLink(text), bad, text);
  assert.deepEqual(parseDiscogsLink(null), bad);
  assert.deepEqual(parseDiscogsLink(undefined), bad);
});
