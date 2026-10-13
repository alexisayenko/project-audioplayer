import assert from 'node:assert/strict';

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
