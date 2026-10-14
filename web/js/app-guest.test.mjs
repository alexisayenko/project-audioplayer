import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

const dom = await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
globalThis.history = { replaceState: (a, b, url) => { location.hash = url; } };
globalThis.setInterval = () => 0;
const nav = document.createElement('nav');
nav.setAttribute('id', 'nav');
for (const r of ['library', 'playback', 'genres', 'settings']) {
  const a = document.createElement('a');
  a.dataset.route = r;
  nav.append(a);
}
document.body.append(nav);

const state = { me: { guest: true, public_view: true, audio: false, owner_label: 'Alex' }, limit: false };
stubFetch((url) => {
  if (url === '/auth/me') return { status: 401, body: {} };
  if (url === '/me') return state.me ? { body: state.me } : { status: 401, body: {} };
  if (url === '/library') {
    if (state.limit) return { status: 429, body: { error: 'guest_limit', detail: 'x', retry_after_minutes: 4 } };
    return { body: { songs: [{ id: 'a', title: 'Alpha', file: 'a.m4a', audio_state: 'server', tags: [], added_at: '2024' }] } };
  }
  if (url === '/health') return { body: { sync: 'ok' } };
  return { body: {} };
});

test('anonymous visitor lands in the read-only library view with a banner and no sign-in redirect', async () => {
  await import('./app.js');
  assert.equal(document.body.dataset.route, 'library');
  assert.ok(document.body.classList.contains('guest'));
  assert.ok(document.body.classList.contains('guest-noaudio'));
  assert.ok(!document.body.classList.contains('signed-out'));
  const banner = document.getElementById('guest-banner');
  assert.match(banner.textContent, /Viewing Alex's library \(read-only\)/);
  assert.equal(document.getElementById('view').querySelector('.head-actions button'), null, 'no Add song button');
  assert.match(document.getElementById('view').textContent, /Alpha/);
});

test('the banner Sign in button goes to Settings, which shows only sign-in', async () => {
  document.getElementById('guest-banner').querySelector('button').click();
  assert.equal(location.hash, '#/settings');
  dom.window.dispatch('hashchange');
  const text = document.getElementById('view').textContent;
  assert.match(text, /You are viewing Alex's library/);
  assert.doesNotMatch(text, /Auto-download/);
});

test('a guest limit answer raises a toast with the minutes to wait', async () => {
  const { store } = await import('./store.js');
  state.limit = true;
  await assert.rejects(store.refresh(), /Guest limit reached\. Sign in or try again in 4 min/);
  assert.match(document.getElementById('toast').textContent, /Guest limit reached\. Sign in or try again in 4 min/);
  state.limit = false;
});

test('signing in leaves guest mode: banner and guest classes go away and the library reloads', async () => {
  const { auth } = await import('./api.js');
  const { clearGuest } = await import('./guest.js');
  auth.email = 'me@x.y';
  clearGuest();
  dom.window.dispatch('auth-changed');
  await flush();
  await flush();
  assert.ok(!document.body.classList.contains('guest'));
  assert.equal(document.getElementById('guest-banner'), null);
});
