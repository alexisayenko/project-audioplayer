import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', file: 'a.mp3', duration: 125, tags: [] },
  { id: 'b', title: 'Beta', artist: 'Yan', file: 'b.mp3', duration: 61, tags: [] },
];
let detail = { id: 'p1', name: 'Road', description: 'Night drive', songs: ['a', 'b'], updated: 'u1' };
let detailResponse = () => ({ body: detail });
const calls = stubFetch((url, o) => {
  if (url === '/library') return { body: { songs: SONGS } };
  if (url === '/playlists/p1' && (!o || !o.method || o.method === 'GET')) return detailResponse();
  if (url === '/playlists') return { body: { playlists: [] } };
  return { body: {} };
});
const { store } = await import('./store.js');
const { renderPlaylistPage } = await import('./playlist-view.js');
store.songs = SONGS;
store.loaded = true;
store.loadedAt = Date.now();

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderPlaylistPage(root, 'p1');
  await flush();
  await flush();
  return { root, cleanup };
}

test('shows the name, description, summary, actions and one row per song', async () => {
  detail = { id: 'p1', name: 'Road', description: 'Night drive', songs: ['a', 'b'], updated: 'u1' };
  const { root, cleanup } = await mount();
  assert.equal(root.querySelector('h1').textContent, 'Road');
  assert.match(root.querySelector('.pl-desc-text').textContent, /Night drive/);
  assert.ok(root.querySelector('[data-role=summary]').textContent.length > 0);
  assert.deepEqual(root.querySelectorAll('.pl-actions button').map((b) => b.textContent), ['Play playlist', 'Add to queue', 'Shuffle', 'Export', 'Edit', 'Delete']);
  assert.equal(root.querySelectorAll('.pl-actions button').filter((b) => b.disabled).length, 0);
  assert.deepEqual(root.querySelectorAll('li.song').map((r) => r.querySelector('.open').textContent), ['Alpha', 'Beta']);
  assert.equal(root.querySelectorAll('li.song .pl-grip').length, 2);
  assert.equal(root.querySelectorAll('li.song .pl-remove').length, 2);
  assert.equal(root.querySelector('.pl-songs').closest?.('.group')?.hidden ?? false, false);
  cleanup();
});

test('an empty playlist says so and disables play, queue and shuffle', async () => {
  detail = { id: 'p1', name: 'Empty', description: '', songs: [], updated: 'u2' };
  const { root, cleanup } = await mount();
  assert.match(root.textContent, /No songs yet/);
  assert.equal(root.querySelector('.pl-desc-text'), null);
  assert.deepEqual(root.querySelectorAll('.pl-actions button').map((b) => b.disabled), [true, true, true, false, false, false]);
  assert.equal(root.querySelectorAll('li.song').length, 0);
  cleanup();
});

test('a missing playlist shows the not-found card', async () => {
  detailResponse = () => ({ status: 404, body: { detail: 'gone' } });
  const { root, cleanup } = await mount();
  assert.match(root.textContent, /This playlist does not exist/);
  assert.equal(root.querySelectorAll('.pl-actions button').length, 0);
  cleanup();
  detailResponse = () => ({ body: detail });
});

test('a load error shows the message and Retry loads the playlist', async () => {
  detail = { id: 'p1', name: 'Road', description: '', songs: ['a'], updated: 'u3' };
  detailResponse = () => ({ status: 500, body: { detail: 'boom' } });
  const { root, cleanup } = await mount();
  assert.match(root.textContent, /boom/);
  detailResponse = () => ({ body: detail });
  const retry = root.querySelectorAll('button').find((b) => b.textContent === 'Retry');
  fire(retry, 'click');
  await flush();
  await flush();
  assert.equal(root.querySelector('h1').textContent, 'Road');
  assert.equal(root.querySelectorAll('li.song').length, 1);
  assert.equal(root.textContent.includes('boom'), false);
  cleanup();
});

test('removing a song calls the server and drops the row', async () => {
  detail = { id: 'p1', name: 'Road', description: '', songs: ['a', 'b'], updated: 'u4' };
  const { root, cleanup } = await mount();
  const before = calls.length;
  fire(root.querySelectorAll('li.song .pl-remove')[0], 'click');
  await flush();
  await flush();
  await flush();
  assert.ok(calls.slice(before).some((c) => c.opts.method === 'DELETE'));
  assert.deepEqual(root.querySelectorAll('li.song').map((r) => r.querySelector('.open').textContent), ['Beta']);
  cleanup();
});

test('Alt with an arrow key moves a row and reorders on the server', async () => {
  detail = { id: 'p1', name: 'Road', description: '', songs: ['a', 'b'], updated: 'u5' };
  const { root, cleanup } = await mount();
  const row = root.querySelectorAll('li.song')[1];
  fire(row, 'keydown', { key: 'ArrowUp', altKey: true, target: row });
  assert.deepEqual(root.querySelectorAll('li.song').map((r) => r.dataset.id), ['b', 'a']);
  cleanup();
  await flush();
});
