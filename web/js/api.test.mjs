import { test } from 'node:test';
import assert from 'node:assert/strict';

test('api', async () => {
  globalThis.localStorage = {
    data: { 'audioplayer.token': 'stale-secret' },
    getItem(k) { return this.data[k] ?? null; },
    setItem(k, v) { this.data[k] = v; },
    removeItem(k) { delete this.data[k]; },
  };
  const calls = [];
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({ songs: [] }) };
  };
  const { api, auth, isSignedIn } = await import('./api.js');

  assert.equal(localStorage.getItem('audioplayer.token'), null, 'stored token is cleared on load');
  assert.equal(isSignedIn(), false, 'a token never signs the web in');
  assert.equal(api.fileUrl('abc'), '/files/abc');

  await api.library();
  assert.equal(calls.at(-1).headers['X-API-Token'], undefined, 'X-API-Token is never sent');

  localStorage.setItem('audioplayer.token', 'again');
  await api.library();
  assert.equal(calls.at(-1).headers['X-API-Token'], undefined, 'a re-stored token is still ignored');
  assert.equal(api.fileUrl('abc'), '/files/abc', 'no ?token= in URLs');

  auth.email = 'a@b.c';
  assert.equal(isSignedIn(), true);
  assert.equal(api.coverUrl('abc'), '/covers/abc');
  auth.email = '';
  assert.equal(isSignedIn(), false);
  console.log('api.test.mjs ok');
});

test('setCover sends multipart for a file and JSON otherwise; deleteCover and coverSuggestions use their routes', async () => {
  const seen = [];
  globalThis.fetch = async (path, init) => { seen.push([path, init.method, init.headers['Content-Type'], init.body]); return { ok: true, status: 200, json: async () => ({}) }; };
  await api.setCover('abc', new Blob(['x'], { type: 'image/png' }));
  await api.setCover('abc', { url: 'https://a.example/x.png' });
  await api.setCover('abc', { default: true });
  await api.deleteCover('abc');
  await api.coverSuggestions('abc');
  assert.equal(seen[0][0], '/songs/abc/cover');
  assert.equal(seen[0][1], 'PUT');
  assert.equal(seen[0][2], undefined);
  assert.ok(seen[0][3] instanceof FormData);
  assert.deepEqual(seen[1], ['/songs/abc/cover', 'PUT', 'application/json', '{"url":"https://a.example/x.png"}']);
  assert.equal(seen[2][3], '{"default":true}');
  assert.deepEqual(seen[3].slice(0, 2), ['/songs/abc/cover', 'DELETE']);
  assert.deepEqual(seen[4].slice(0, 2), ['/songs/abc/cover/suggestions', 'GET']);
});
