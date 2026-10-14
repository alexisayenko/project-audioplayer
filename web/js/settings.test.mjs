import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

const dom = await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
const { store } = await import('./store.js');
const { auth } = await import('./api.js');
const { renderSettings } = await import('./settings.js');
const { autoDownloadOn } = await import('./autodl.js');

function route({ cfg = {}, usage = { songs: 3, bytes: 5 * 1024 ** 2, max_songs: 100, max_bytes: 10 * 1024 ** 3 }, health = { sync: 'ok' }, session = null, end = {} } = {}) {
  return stubFetch((url, o) => {
    if (url === '/auth/config') return { body: cfg };
    if (url === '/auth/session') return session || { body: { email: 'me@x.y', provider: 'google' } };
    if (url === '/auth/logout') return { body: end };
    if (url === '/me/usage') return { body: usage };
    if (url === '/health') return { body: health };
    if (url === '/library') return { body: { songs: [] } };
    return { status: 404, body: {} };
  });
}
const mount = () => { const root = document.createElement('div'); document.body.append(root); const cleanup = renderSettings(root); return { root, cleanup }; };

test('signed out: invites sign-in, shows providers from config, hides the library card', async () => {
  auth.email = '';
  route({ cfg: { google_client_id: 'gid', apple_client_id: '' } });
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /Sign in to see your library/);
  assert.match(root.textContent, /Sign in with Google/);
  assert.doesNotMatch(root.textContent, /Sign in with Apple/);
  assert.doesNotMatch(root.textContent, /Library on the server/);
  cleanup();
});

test('no providers configured says so', async () => {
  auth.email = '';
  route({ cfg: {} });
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /Sign-in is not configured on the server/);
  cleanup();
});

test('config failure is shown as an error, not a crash', async () => {
  auth.email = '';
  stubFetch(() => ({ status: 500, body: { detail: 'config broke' } }));
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /config broke/);
  cleanup();
});

test('signed in: shows the account, library stats, storage meter, sync and server', async () => {
  auth.email = 'me@x.y';
  store.songs = [{ id: 'a', duration: 3600 }, { id: 'b', duration: 1800 }];
  route({ cfg: {}, health: { sync: 'error' } });
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /Signed in as me@x\.y/);
  assert.match(root.textContent, /2 songs/);
  assert.match(root.textContent, /1\.5 h of music/);
  assert.match(root.textContent, /3 \/ 100 songs/);
  assert.match(root.textContent, /Not reaching git/);
  assert.match(root.textContent, /music\.example/);
  cleanup();
});

test('library card follows store refreshes and stops after cleanup', async () => {
  auth.email = 'me@x.y';
  store.songs = [];
  route();
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /0 songs/);
  store.songs = [{ id: 'x', duration: 60 }];
  store.listeners.forEach((fn) => fn());
  await flush();
  assert.match(root.textContent, /1 song1 min of music/);
  cleanup();
  const n = store.listeners.size;
  cleanup();
  assert.equal(store.listeners.size, n);
});

test('health unreachable is reported', async () => {
  auth.email = 'me@x.y';
  stubFetch((url) => (url === '/health' ? Promise.reject(new Error('x')) : { body: { songs: [] } }));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, o) => { if (url === '/health') throw new Error('down'); return orig(url, o); };
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /Server unreachable/);
  cleanup();
});

test('Sign out ends the session, clears the store and announces auth-changed', async () => {
  auth.email = 'me@x.y';
  store.songs = [{ id: 'a' }];
  store.loaded = true;
  const calls = route();
  let changed = 0;
  dom.window.addEventListener('auth-changed', () => { changed += 1; });
  const { root, cleanup } = mount();
  await flush();
  root.querySelectorAll('button').find((b) => b.textContent === 'Sign out').click();
  await flush();
  assert.ok(calls.some((c) => c.url === '/auth/logout' && c.opts.method === 'POST'));
  assert.deepEqual(store.songs, []);
  assert.equal(store.loaded, false);
  assert.equal(auth.email, '');
  assert.equal(changed, 1);
  cleanup();
});

test('Sign out still clears the local state when the server call fails', async () => {
  auth.email = 'me@x.y';
  store.songs = [{ id: 'a' }];
  stubFetch((url) => (url === '/auth/logout' ? { status: 500, body: {} } : { body: {} }));
  const { root, cleanup } = mount();
  await flush();
  root.querySelectorAll('button').find((b) => b.textContent === 'Sign out').click();
  await flush();
  assert.deepEqual(store.songs, []);
  cleanup();
});

test('auto-download switch persists and tells the player', async () => {
  auth.email = 'me@x.y';
  route();
  const { root, cleanup } = mount();
  await flush();
  const box = root.querySelector('#auto-dl');
  assert.equal(autoDownloadOn(), false);
  box.checked = true;
  box.dispatchEvent({ type: 'change', target: box });
  assert.equal(autoDownloadOn(), true);
  assert.equal(localStorage.getItem('ap2.autodl'), '1');
  box.checked = false;
  box.dispatchEvent({ type: 'change', target: box });
  assert.equal(autoDownloadOn(), false);
  cleanup();
});

test('Google sign-in: script loads, initialises and a credential signs in then opens the library', async () => {
  auth.email = '';
  const calls = route({ cfg: { google_client_id: 'gid' } });
  let init = null;
  let rendered = 0;
  dom.window.google = { accounts: { id: { initialize: (o) => { init = o; }, renderButton: () => { rendered += 1; } } } };
  globalThis.google = dom.window.google;
  Object.defineProperty(globalThis.window, 'google', { value: dom.window.google, configurable: true, writable: true });
  const { root, cleanup } = mount();
  await flush();
  await flush();
  assert.equal(init.client_id, 'gid');
  assert.equal(rendered, 1);
  await init.callback({ credential: 'jwt-token' });
  const post = calls.find((c) => c.url === '/auth/session');
  assert.deepEqual(JSON.parse(post.opts.body), { id_token: 'jwt-token' });
  assert.equal(auth.email, 'me@x.y');
  assert.equal(location.hash, '#/library');
  assert.ok(root.textContent.length > 0);
  cleanup();
});

test('a rejected credential shows the server message and stays signed out', async () => {
  auth.email = '';
  location.hash = '';
  route({ cfg: { google_client_id: 'gid' }, session: { status: 403, body: { error: 'signup_closed' } } });
  let init = null;
  window.google = { accounts: { id: { initialize: (o) => { init = o; }, renderButton() {} } } };
  const { root, cleanup } = mount();
  await flush();
  await flush();
  await init.callback({ credential: 'bad' });
  assert.match(root.textContent, /Sign-up is closed/);
  assert.equal(auth.email, '');
  assert.equal(location.hash, '');
  cleanup();
});
