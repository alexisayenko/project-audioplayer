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

function setup({ drafts = [draft('d1'), draft('d2')], fail = false, keepStored = false } = {}) {
  if (!keepStored) localStorage.clear();
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
    if (url === '/tags') return { body: [] };
    return { body: {} };
  });
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderLibrary(root);
  const tabs = () => root.querySelectorAll('[role=tab]');
  const total = () => root.querySelector('.head-actions .muted').textContent;
  return { root, cleanup, calls, tabs, total, songsPane: () => root.querySelector('#lib-songs'), draftsPane: () => root.querySelector('#lib-drafts') };
}

test('the Library has a Songs | Drafts tablist; the Drafts tab shows the draft count once it is known', async () => {
  const v = setup();
  assert.equal(v.root.querySelector('[role=tablist]').getAttribute('aria-label'), 'Library view');
  const [songs, drafts] = v.tabs();
  assert.equal(songs.textContent, 'Songs');
  assert.equal(songs.getAttribute('aria-selected'), 'true');
  assert.equal(drafts.getAttribute('aria-selected'), 'false');
  await flush();
  await flush();
  assert.equal(drafts.textContent, 'Drafts2');
  assert.equal(drafts.getAttribute('aria-label'), 'Drafts, 2');
  assert.equal(v.total(), '2 songs');
  v.cleanup();
});

test('the Drafts tab swaps the song list for the draft list and hides search, chips, sort and the list actions', async () => {
  const v = setup();
  await flush();
  await flush();
  const search = v.root.querySelector('input[type=search]');
  search.value = 'alp';
  search.dispatchEvent(makeEvent('input', { target: search }));
  v.tabs()[1].click();
  assert.equal(v.tabs()[1].getAttribute('aria-selected'), 'true');
  assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'false');
  assert.equal(v.songsPane().hidden, true);
  assert.equal(v.draftsPane().hidden, false);
  assert.ok(v.songsPane().querySelector('.toolbar') && v.songsPane().querySelector('.cats') && v.songsPane().querySelector('.sortbar'), 'search, chips and sort live in the hidden songs pane');
  assert.equal(v.total(), '2 drafts');
  assert.equal(v.draftsPane().querySelectorAll('li.draft').length, 2);
  assert.ok(v.draftsPane().querySelector('textarea'));
  assert.equal(v.root.querySelectorAll('li.song').length, 1, 'the song list keeps its filter');
  v.tabs()[0].click();
  assert.equal(v.songsPane().hidden, false);
  assert.equal(v.draftsPane().hidden, true);
  assert.equal(v.total(), '2 songs');
  assert.equal(v.root.querySelector('input[type=search]').value, 'alp');
  v.cleanup();
});

test('arrow keys, Home and End move between the tabs and focus the chosen one', async () => {
  const v = setup();
  await flush();
  const list = v.root.querySelector('[role=tablist]');
  list.dispatchEvent(makeEvent('keydown', { key: 'ArrowRight' }));
  assert.equal(v.tabs()[1].getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, v.tabs()[1]);
  assert.equal(v.tabs()[1].tabIndex, 0);
  assert.equal(v.tabs()[0].tabIndex, -1);
  list.dispatchEvent(makeEvent('keydown', { key: 'ArrowLeft' }));
  assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'true');
  list.dispatchEvent(makeEvent('keydown', { key: 'End' }));
  assert.equal(v.tabs()[1].getAttribute('aria-selected'), 'true');
  list.dispatchEvent(makeEvent('keydown', { key: 'Home' }));
  assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'true');
  list.dispatchEvent(makeEvent('keydown', { key: 'Tab' }));
  assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'true');
  v.cleanup();
});

test('the view is remembered when the Library is rendered again in the same page session', async () => {
  const first = setup();
  await flush();
  first.tabs()[1].click();
  first.cleanup();
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderLibrary(root);
  assert.equal(root.querySelector('#lib-drafts').hidden, false);
  assert.equal(root.querySelector('#lib-songs').hidden, true);
  cleanup();
});

test('pasting in the Drafts view raises the count on the tab and in the header', async () => {
  const v = setup();
  await flush();
  await flush();
  v.tabs()[1].click();
  v.draftsPane().querySelector('textarea').value = 'New - Song';
  v.draftsPane().querySelector('form.drafts-paste').dispatchEvent(makeEvent('submit'));
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(v.tabs()[1].textContent, 'Drafts3');
  assert.equal(v.total(), '3 drafts');
  v.cleanup();
});

test('a failing draft load shows the tab without a count and Retry in the Drafts view', async () => {
  const v = setup({ fail: true });
  await flush();
  await flush();
  assert.equal(v.tabs()[1].textContent, 'Drafts');
  assert.equal(v.tabs()[1].getAttribute('aria-label'), 'Drafts');
  v.tabs()[1].click();
  assert.match(v.draftsPane().textContent, /down/);
  assert.equal(v.total(), '');
  v.cleanup();
});

test('a guest gets no Drafts tab, no tablist and no request for drafts', async () => {
  guest.setGuest({ guest: true, audio: true });
  const v = setup();
  await flush();
  assert.equal(v.root.querySelectorAll('[role=tablist]').length, 0);
  assert.equal(v.root.querySelector('#lib-drafts').hidden, true);
  assert.equal(v.songsPane().hidden, false);
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

const KEY = 'electrophone.libraryView';

test('a stored Drafts choice restores the Drafts tab; choosing a tab stores it', async () => {
  localStorage.setItem(KEY, 'drafts');
  const v = setup({ keepStored: true });
  assert.equal(v.tabs()[1].getAttribute('aria-selected'), 'true');
  assert.equal(v.draftsPane().hidden, false);
  v.tabs()[0].click();
  assert.equal(localStorage.getItem(KEY), 'songs');
  v.tabs()[1].click();
  assert.equal(localStorage.getItem(KEY), 'drafts');
  v.cleanup();
});

test('an invalid stored value is ignored and the Songs tab shows', async () => {
  localStorage.setItem(KEY, 'playlists');
  const v = setup({ keepStored: true });
  assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'true');
  assert.equal(v.draftsPane().hidden, true);
  v.cleanup();
});

test('a guest always gets Songs and the stored value is left alone', async () => {
  localStorage.setItem(KEY, 'drafts');
  guest.setGuest({ guest: true, audio: true });
  const v = setup({ keepStored: true });
  assert.equal(v.root.querySelectorAll('[role=tablist]').length, 0);
  assert.equal(v.songsPane().hidden, false);
  assert.equal(prefs.view, 'songs');
  assert.equal(localStorage.getItem(KEY), 'drafts');
  v.cleanup();
  guest.clearGuest();
});

test('signing out resets the view to Songs', async () => {
  prefs.view = 'drafts';
  window.dispatchEvent(makeEvent('auth-changed'));
  assert.equal(prefs.view, 'songs');
});

test('blocked storage (reads and writes throw) does not break the tabs', async () => {
  const real = localStorage;
  const boom = () => { throw new Error('blocked'); };
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: boom, setItem: boom, removeItem: boom, clear() {} }, configurable: true, writable: true });
  try {
    const v = setup({ keepStored: true });
    assert.equal(v.tabs()[0].getAttribute('aria-selected'), 'true');
    v.tabs()[1].click();
    assert.equal(v.draftsPane().hidden, false);
    v.cleanup();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
  }
});
