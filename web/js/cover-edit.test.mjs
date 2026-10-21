import test from 'node:test';
import assert from 'node:assert/strict';
import { fileProblem, urlProblem, coverError, COVER_MAX_BYTES } from './cover-edit.js';
import { api } from './api.js';

test('fileProblem checks presence, type and size', () => {
  assert.match(fileProblem(null), /Choose/);
  assert.match(fileProblem({ type: 'image/gif', size: 10 }), /JPEG, PNG or WebP/);
  assert.match(fileProblem({ type: 'image/svg+xml', size: 10 }), /JPEG, PNG or WebP/);
  assert.match(fileProblem({ type: 'image/png', size: COVER_MAX_BYTES + 1 }), /5 MB/);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(fileProblem({ type, size: COVER_MAX_BYTES }), '');
});

test('urlProblem accepts only http and https addresses', () => {
  assert.equal(urlProblem(' https://a.example/x.jpg '), '');
  assert.equal(urlProblem('http://a.example/x.jpg'), '');
  assert.match(urlProblem(''), /Enter an image address/);
  assert.match(urlProblem('a.example/x.jpg'), /http/);
  assert.match(urlProblem('file:///etc/passwd'), /http/);
  assert.match(urlProblem('javascript:alert(1)'), /http/);
});

test('coverError prefers the server message', () => {
  assert.equal(coverError({ status: 502, message: 'Could not reach that address.' }), 'Could not reach that address.');
  assert.match(coverError({ status: 0, message: 'Server unreachable' }), /Could not reach the server/);
  assert.match(coverError({ status: 413 }), /5 MB/);
  assert.match(coverError(null), /Could not change/);
});

test('coverUrl adds the version only when there is one', () => {
  assert.equal(api.coverUrl('abc'), '/covers/abc');
  assert.equal(api.coverUrl('abc', null), '/covers/abc');
  assert.equal(api.coverUrl('abc', 'f00d'), '/covers/abc?v=f00d');
});

test('cover calls use the right method and path', async () => {
  const seen = [];
  globalThis.fetch = async (path, init) => { seen.push([path, init.method, init.headers['Content-Type'], init.body]); return { ok: true, status: 200, json: async () => ({}) }; };
  const blob = { type: 'image/png' };
  await api.uploadCover('abc', blob);
  await api.coverFromUrl('abc', 'https://a.example/x.png');
  await api.removeCover('abc');
  assert.deepEqual(seen[0], ['/songs/abc/cover', 'PUT', 'image/png', blob]);
  assert.deepEqual(seen[1], ['/songs/abc/cover/from-url', 'POST', 'application/json', '{"url":"https://a.example/x.png"}']);
  assert.deepEqual(seen[2].slice(0, 2), ['/songs/abc/cover', 'DELETE']);
});

test('isDiscogsPage accepts master and release pages on discogs.com only', async () => {
  const { isDiscogsPage } = await import('./cover-edit.js');
  assert.equal(isDiscogsPage('https://www.discogs.com/master/5659-Hallucinogen-Twisted?redirected=true'), true);
  assert.equal(isDiscogsPage('https://discogs.com/release/123'), true);
  assert.equal(isDiscogsPage('https://www.discogs.com/en/release/123-Some-Title'), true);
  assert.equal(isDiscogsPage('https://www.discogs.com/artist/123-Name'), false);
  assert.equal(isDiscogsPage('https://discogs.com.evil.com/master/5659'), false);
  assert.equal(isDiscogsPage('https://i.discogs.com/abc.jpeg'), false);
  assert.equal(isDiscogsPage('nonsense'), false);
});
