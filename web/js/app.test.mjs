import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

const dom = await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
globalThis.history = { replaceState: (a, b, url) => { location.hash = url; } };
globalThis.setInterval = (fn, ms) => { if (ms === 30000) globalThis.__poll = fn; return 0; };
const nav = document.createElement('nav');
nav.setAttribute('id', 'nav');
for (const r of ['library', 'playback', 'playlists', 'genres', 'settings']) {
  const a = document.createElement('a');
  a.dataset.route = r;
  nav.append(a);
}
document.body.append(nav);

const state = { signedIn: false, health: { sync: 'ok' }, healthOk: true };
stubFetch((url) => {
  if (url === '/auth/me') return state.signedIn ? { body: { method: 'session', email: 'me@x.y', provider: 'google' } } : { status: 401, body: {} };
  if (url === '/library') return { body: { songs: [{ id: 'a', title: 'Alpha', file: 'a.mp3', tags: [], added_at: '2024' }] } };
  if (url === '/health') return state.healthOk ? { body: state.health } : { status: 503, body: {} };
  if (url === '/genres/graph') return { body: { nodes: [], edges: [] } };
  return { body: {} };
});

test('signed out at boot: the app redirects to Settings and marks the body signed-out', async () => {
  await import('./app.js');
  assert.equal(location.hash, '#/settings');
  assert.equal(document.body.dataset.route, undefined, 'redirect happens before rendering a route');
});

test('settings renders for a signed-out user and nav marks it active', async () => {
  dom.window.dispatch('hashchange');
  assert.equal(document.body.dataset.route, 'settings');
  assert.match(document.getElementById('view').textContent, /Loading/, 'the lazy route shows its loading state first');
  await flush();
  assert.ok(document.body.classList.contains('signed-out'));
  const active = nav.querySelectorAll('a').filter((a) => a.classList.contains('active')).map((a) => a.dataset.route);
  assert.deepEqual(active, ['settings']);
  assert.equal(nav.querySelector('.active').getAttribute('aria-current'), 'page');
  assert.match(document.getElementById('view').textContent, /Settings/);
});

test('other routes are refused while signed out', () => {
  location.hash = '#/library';
  dom.window.dispatch('hashchange');
  assert.equal(location.hash, '#/settings');
});

test('server led and sync warning reflect /health', async () => {
  assert.equal(document.getElementById('server-text'), null);
  const status = document.getElementById('server-led').parentElement;
  assert.equal(status.getAttribute('aria-label'), 'Server online · music.example');
  assert.equal(status.title, 'Server online · music.example');
  assert.equal(document.getElementById('sync-warn').hidden, true);
});

test('after sign-in the library route renders and the nav follows hash changes', async () => {
  const { auth } = await import('./api.js');
  const { store } = await import('./store.js');
  auth.email = 'me@x.y';
  await store.refresh();
  location.hash = '#/library';
  dom.window.dispatch('auth-changed');
  assert.equal(document.body.dataset.route, 'library');
  assert.ok(!document.body.classList.contains('signed-out'));
  await flush();
  assert.match(document.getElementById('view').textContent, /Alpha/);
  location.hash = '#/playback';
  dom.window.dispatch('hashchange');
  assert.equal(document.body.dataset.route, 'playback');
  assert.equal(document.getElementById('player').hidden, false);
  location.hash = '#/nonsense';
  dom.window.dispatch('hashchange');
  assert.equal(document.body.dataset.route, 'library', 'unknown routes fall back to the library');
});

test('#/add opens the add dialog over the library and rewrites the hash', async () => {
  location.hash = '#/add';
  dom.window.dispatch('hashchange');
  assert.equal(location.hash, '#/library');
  await flush();
  assert.equal(document.getElementById('add-dialog').open, true);
  document.getElementById('add-dialog').close();
});

test('signing out pauses the player and bounces to Settings', async () => {
  const { auth } = await import('./api.js');
  const audio = document.getElementById('audio');
  audio.play();
  auth.email = '';
  dom.window.dispatch('auth-changed');
  assert.equal(audio.paused, true);
  assert.equal(location.hash, '#/settings');
});

test('sidebar toggle flips the collapsed class, aria and persists', () => {
  const t = document.getElementById('side-toggle');
  assert.equal(t.getAttribute('aria-expanded'), 'true');
  t.click();
  assert.ok(document.body.classList.contains('side-collapsed'));
  assert.equal(t.getAttribute('aria-expanded'), 'false');
  assert.equal(t.getAttribute('aria-label'), 'Expand sidebar');
  assert.equal(localStorage.getItem('electrophone.sidebarCollapsed'), '1');
  t.click();
  assert.ok(!document.body.classList.contains('side-collapsed'));
  assert.equal(t.title, 'Collapse sidebar');
});

const settingsLink = () => [...document.querySelectorAll('#nav a')].find((a) => a.dataset.route === 'settings');

test('stale and error mark the Settings nav item and banner; pending and ok clear them', async () => {
  const { clearGuest } = await import('./guest.js');
  clearGuest();
  state.healthOk = true;
  const cases = [
    [{ state: 'pending', unpushed: 1 }, null, true],
    [{ state: 'stale', unpushed: 2, last_push_at: null, timer_seen: true }, 'warn', false],
    [{ state: 'error', repos: [{ rejected: true }] }, 'error', false],
    [{ state: 'ok', unpushed: 0 }, null, true],
  ];
  for (const [sync, level, hidden] of cases) {
    state.health = { sync };
    assert.ok(globalThis.__poll);
    await globalThis.__poll();
    await flush();
    assert.equal(settingsLink().getAttribute('data-sync'), level);
    assert.equal(document.getElementById('sync-warn').hidden, hidden);
    if (level) assert.match(settingsLink().getAttribute('aria-label'), /^Settings, Sync /);
  }
  state.health = { sync: 'ok' };
});

test('guests never get a sync mark', async () => {
  const { setGuest, clearGuest } = await import('./guest.js');
  setGuest({});
  state.healthOk = true;
  state.health = { sync: { state: 'degraded' } };
  await globalThis.__poll();
  await flush();
  assert.equal(settingsLink().getAttribute('data-sync'), null);
  assert.equal(document.getElementById('sync-warn').hidden, true);
  clearGuest();
  state.health = { sync: 'ok' };
});

test('the owner build line follows /health and disappears without a build or when offline', async () => {
  const el = document.getElementById('server-build');
  assert.equal(el.hidden, true);
  state.healthOk = true;
  state.health = { sync: 'ok', build: { sha: '68df2bf0123456789abcdef0123456789abcdef0', committed_at: '2026-10-17T08:00:00Z', deployed_at: '2026-10-17T12:05:00Z' } };
  await globalThis.__poll();
  await flush();
  assert.equal(el.hidden, false);
  assert.match(el.textContent, /^68df2bf · \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/);
  assert.match(el.title, /^Commit 68df2bf0123456789abcdef0123456789abcdef0\ncommitted 2026-10-17 08:00 UTC\ndeployed 2026-10-17 12:05 UTC$/);
  state.health = { sync: 'ok' };
  await globalThis.__poll();
  await flush();
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');
  state.health = { sync: 'ok', build: { sha: '68df2bf0123456789abcdef0123456789abcdef0', deployed_at: '2026-10-17T12:05:00Z' } };
  await globalThis.__poll();
  await flush();
  state.healthOk = false;
  await globalThis.__poll();
  await flush();
  assert.equal(el.hidden, true);
  state.healthOk = true;
  state.health = { sync: 'ok' };
});
