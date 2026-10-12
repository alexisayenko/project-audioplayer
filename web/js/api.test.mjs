import assert from 'node:assert/strict';

globalThis.localStorage = {
  data: {},
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; },
};
const { api, auth, setToken, isSignedIn } = await import('./api.js');

assert.equal(isSignedIn(), false);
assert.equal(api.fileUrl('abc'), '/files/abc');

setToken('secret');
assert.equal(isSignedIn(), true);
assert.equal(api.fileUrl('abc'), '/files/abc?token=secret');

auth.email = 'a@b.c';
assert.equal(api.fileUrl('abc'), '/files/abc', 'session sign-in keeps tokens out of URLs');
assert.equal(api.coverUrl('abc'), '/covers/abc');

setToken('');
assert.equal(isSignedIn(), true);
auth.email = '';
assert.equal(isSignedIn(), false);
console.log('api.test.mjs ok');
