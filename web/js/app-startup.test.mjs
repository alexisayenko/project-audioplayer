import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
globalThis.history = { replaceState: (a, b, url) => { location.hash = url; } };
globalThis.setInterval = () => 0;
const nav = document.createElement('nav');
nav.setAttribute('id', 'nav');
for (const r of ['library', 'playback', 'playlists', 'genres', 'genres2', 'settings']) {
  const a = document.createElement('a');
  a.dataset.route = r;
  nav.append(a);
}
document.body.append(nav);

let release;
const gate = new Promise((r) => { release = r; });
const started = [];
const calls = stubFetch(async (url) => {
  if (['/auth/me', '/me', '/library'].includes(url)) {
    started.push(url);
    if (started.length === 3) release();
    await gate;
  }
  if (url === '/auth/me') return { status: 401, body: {} };
  if (url === '/me') return { body: { guest: true, public_view: true, audio: true, owner_label: 'Alex' } };
  if (url === '/library') return { body: { songs: [{ id: 'a', title: 'Alpha', file: 'a.m4a', audio_state: 'server', tags: [], added_at: '2024' }] } };
  if (url === '/health') return { body: { sync: 'ok' } };
  return { body: {} };
});

test('WEB-116: /auth/me, /me and /library start together; a guest start loads /library once', async () => {
  await import('./app.js');
  assert.deepEqual([...started].sort(), ['/auth/me', '/library', '/me']);
  await flush();
  assert.match(document.getElementById('view').textContent, /Alpha/);
  assert.equal(calls.filter((c) => c.url === '/library').length, 1, 'the Library page reuses the startup fetch');
  assert.equal(calls.filter((c) => c.url === '/me').length, 1);
});
