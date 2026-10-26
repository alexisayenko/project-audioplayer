import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { renderLibrary } = await import('./library.js');
const { prefs } = await import('./library-data.js');
const { draftStore } = await import('./drafts.js');
const guest = await import('./guest.js');
const { initPlayer } = await import('./player.js');
initPlayer();

const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', file: 'a.mp3', duration: 125, added_at: '2024-01-01', tags: ['genre:rock'] },
  { id: 'b', title: 'Beta', artist: 'Yan', file: 'b.mp3', duration: 61, added_at: '2024-03-01', tags: ['genre:jazz'] },
];
const draft = (id, extra = {}) => ({ id, text: `Artist - ${id}`, url: '', source: null, title: id, mainArtists: ['Artist'], featuredArtists: [], withArtists: [], version: null, year: null, duration: null, thumbnail: null, state: 'new', inLibrary: false, createdAt: '2026-10-18T10:00:00Z', ...extra });
function setup({ drafts = [draft('d1'), draft('d2')], fail = false, hash = '' } = {}) {
  location.hash = hash;
  draftStore.reset();
  prefs.view = 'songs';
  prefs.query = '';
  store.songs = SONGS;
  store.loaded = true;
  store.tags = [{ tag: 'genre:rock', count: 1 }, { tag: 'genre:jazz', count: 1 }];
  const calls = stubFetch((url, o) => {
    if (url === '/drafts' && o.method === 'GET') return fail ? { status: 500, body: { detail: 'down' } } : { body: { drafts, counts: { total: drafts.length }, limit: 500 } };
    if (url === '/drafts' && o.method === 'POST') return { body: { created: [draft('n1')], updated: [], counts: { created: 1 } } };
    if (url === '/library') return { body: { songs: SONGS } };
    if (url === '/tags' || url === '/albums') return { body: [] };
    return { body: {} };
  });
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderLibrary(root);
  const total = () => root.querySelector('.head-actions .muted').textContent;
  const q = (id) => root.querySelector(id);
  return { root, cleanup, calls, total, songsPane: () => q('#lib-songs'), albumsPane: () => q('#lib-albums'), draftsPane: () => q('#lib-drafts') };
}

test('LIB-159: the Library has no in-page switch any more; the menu routes choose the view', async () => {
  const v = setup();
  assert.equal(v.root.querySelectorAll('[role=tablist]').length, 0);
  assert.equal(v.songsPane().hidden, false);
  assert.equal(v.albumsPane().hidden, true);
  assert.equal(v.draftsPane().hidden, true);
  assert.equal(v.root.querySelector('h1').textContent, 'Library');
  v.cleanup();
});

test('#/library/albums shows the Albums view', async () => {
  const v = setup({ hash: '#/library/albums' });
  assert.equal(v.albumsPane().hidden, false);
  assert.equal(v.songsPane().hidden, true);
  await flush();
  await flush();
  assert.ok(v.albumsPane().querySelector('.albums-row'));
  assert.equal(v.root.querySelector('h1').textContent, 'Albums');
  assert.equal(v.total(), '');
  v.cleanup();
});

test('#/library/drafts swaps the song list for the draft list; the songs pane keeps its filter', async () => {
  const v = setup({ hash: '#/library/drafts' });
  await flush();
  await flush();
  assert.equal(v.songsPane().hidden, true);
  assert.equal(v.draftsPane().hidden, false);
  assert.ok(v.songsPane().querySelector('.toolbar') && v.songsPane().querySelector('.cats') && v.songsPane().querySelector('.sortbar'));
  assert.equal(v.total(), '2 drafts');
  assert.equal(v.draftsPane().querySelectorAll('li.draft').length, 2);
  assert.ok(v.draftsPane().querySelector('textarea'));
  assert.equal(v.root.querySelector('h1').textContent, 'Drafts');
  v.cleanup();
});

test('pasting in the Drafts view raises the count in the header', async () => {
  const v = setup({ hash: '#/library/drafts' });
  await flush();
  await flush();
  v.draftsPane().querySelector('textarea').value = 'New - Song';
  v.draftsPane().querySelector('form.drafts-paste').dispatchEvent(makeEvent('submit'));
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(v.total(), '3 drafts');
  v.cleanup();
});

test('a failing draft load shows Retry in the Drafts view', async () => {
  const v = setup({ fail: true, hash: '#/library/drafts' });
  await flush();
  await flush();
  assert.match(v.draftsPane().textContent, /down/);
  assert.equal(v.total(), '');
  v.cleanup();
});

test('a guest gets Songs on every Library route and no request for drafts', async () => {
  guest.setGuest({ guest: true, audio: true });
  const v = setup({ hash: '#/library/drafts' });
  await flush();
  assert.equal(v.songsPane().hidden, false);
  assert.equal(v.draftsPane().hidden, true);
  assert.equal(v.calls.filter((c) => c.url === '/drafts').length, 0);
  v.cleanup();
  guest.clearGuest();
});

test('cleaning up stops listening to the draft store', async () => {
  const v = setup();
  await flush();
  await flush();
  v.cleanup();
  assert.equal(draftStore.subs.size, 0);
});
