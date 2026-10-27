import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';
import { keepsLibrary, warmModule, warmOnIntent } from './route-keep.js';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { renderLibrary } = await import('./library.js');
const { prefs } = await import('./library-data.js');
const { draftStore } = await import('./drafts.js');
const { lazyPane } = await import('./library-panes.js');
const { initPlayer } = await import('./player.js');
initPlayer();

const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', file: 'a.mp3', duration: 125, added_at: '2024-01-01', tags: ['genre:rock'] },
  { id: 'b', title: 'Beta', artist: 'Yan', file: 'b.mp3', duration: 61, added_at: '2024-03-01', tags: ['genre:jazz'] },
];

function setup(hash = '') {
  location.hash = hash;
  draftStore.reset();
  prefs.view = 'songs';
  prefs.query = '';
  store.songs = SONGS;
  store.loaded = true;
  store.loadedAt = Date.now();
  store.tags = [];
  const calls = stubFetch((url) => {
    if (url === '/library') return { body: { songs: SONGS } };
    if (url === '/drafts') return { body: { drafts: [], counts: { total: 0 }, limit: 500 } };
    if (url === '/albums') return { body: [] };
    return { body: {} };
  });
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderLibrary(root);
  return { root, cleanup, calls, rows: () => root.querySelectorAll('#lib-songs li.song') };
}

test('keepsLibrary only for a hash change from the Library to the Library with a retargetable page', () => {
  const cleanup = Object.assign(() => {}, { retarget: () => {} });
  const base = { soft: true, name: 'library', current: 'library', cleanup, hasContent: true };
  assert.equal(keepsLibrary(base), true);
  assert.equal(keepsLibrary({ ...base, soft: false }), false, 'auth changes rebuild');
  assert.equal(keepsLibrary({ ...base, name: 'settings' }), false);
  assert.equal(keepsLibrary({ ...base, current: 'login' }), false);
  assert.equal(keepsLibrary({ ...base, cleanup: () => {} }), false);
  assert.equal(keepsLibrary({ ...base, cleanup: null }), false);
  assert.equal(keepsLibrary({ ...base, hasContent: null }), false);
});

test('warmModule maps the Albums and Drafts items to their lazy module; hover and focus load it once per event', () => {
  assert.equal(warmModule('library/albums'), 'albums');
  assert.equal(warmModule('library/drafts'), 'drafts');
  assert.equal(warmModule('library'), null);
  assert.equal(warmModule(undefined), null);
  const listeners = {};
  const nav = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const loaded = [];
  warmOnIntent(nav, (name) => { loaded.push(name); return Promise.reject(new Error('offline')); });
  assert.deepEqual(Object.keys(listeners).sort(), ['focusin', 'pointerover', 'touchstart']);
  const target = (route) => ({ target: { closest: () => ({ dataset: { route } }) } });
  listeners.pointerover(target('library/albums'));
  listeners.focusin(target('playback'));
  listeners.touchstart({ target: {} });
  assert.deepEqual(loaded, ['albums']);
});

test('retarget switches Songs to Albums to Songs without rebuilding the song rows', async () => {
  const v = setup('#/library');
  await flush();
  await flush();
  const before = [...v.rows()];
  assert.equal(before.length, 2);
  location.hash = '#/library/albums';
  v.cleanup.retarget();
  assert.equal(v.root.querySelector('#lib-albums').hidden, false);
  assert.equal(v.root.querySelector('#lib-songs').hidden, true);
  assert.equal(v.root.querySelector('h1').textContent, 'Albums');
  await flush();
  await flush();
  location.hash = '#/library';
  v.cleanup.retarget();
  assert.equal(v.root.querySelector('#lib-songs').hidden, false);
  assert.equal(v.root.querySelector('h1').textContent, 'Library');
  const after = [...v.rows()];
  assert.equal(after.length, 2);
  assert.ok(after.every((row, i) => row === before[i]), 'the same row elements stay in place');
  v.cleanup();
});

test('a song-list change while the songs pane is hidden waits and paints when Songs is shown again', async () => {
  const v = setup('#/library');
  location.hash = '#/library/albums';
  v.cleanup.retarget();
  await flush();
  store.songs = [...SONGS, { id: 'c', title: 'Gamma', artist: 'Xi', file: 'c.mp3', duration: 9, added_at: '2024-04-01', tags: [] }];
  store.listeners.forEach((fn) => fn());
  assert.equal(v.rows().length, 2, 'hidden pane is not rebuilt');
  assert.match(v.root.querySelector('.head-actions .muted').textContent, /^$|album/, 'the header total is not the song count');
  location.hash = '#/library';
  v.cleanup.retarget();
  assert.equal(v.rows().length, 3);
  assert.match(v.root.querySelector('.head-actions .muted').textContent, /3 songs/);
  v.cleanup();
});

test('retarget to Songs refreshes a stale library but a fresh one is not fetched', async () => {
  const v = setup('#/library/albums');
  await flush();
  const libCalls = () => v.calls.filter((c) => c.url === '/library').length;
  location.hash = '#/library';
  v.cleanup.retarget();
  await flush();
  const fresh = libCalls();
  location.hash = '#/library/albums';
  v.cleanup.retarget();
  location.hash = '#/library';
  v.cleanup.retarget();
  await flush();
  assert.equal(libCalls(), fresh, 'fresh data is not fetched again');
  store.loadedAt -= 60000;
  location.hash = '#/library/albums';
  v.cleanup.retarget();
  location.hash = '#/library';
  v.cleanup.retarget();
  await flush();
  assert.equal(libCalls(), fresh + 1);
  v.cleanup();
});

test('lazyPane refreshes an already mounted pane only once it is older than freshMs', async () => {
  const { UI_LOADERS } = await import('./lazy-ui.js');
  const refreshed = [];
  const unmounted = [];
  const mod = { mountThing: () => Object.assign(() => unmounted.push(1), { refresh: () => refreshed.push(1) }) };
  UI_LOADERS.fakeThing = () => Promise.resolve(mod);
  try {
    const pane = document.createElement('div');
    let clock = 0;
    const lazy = lazyPane(pane, { module: 'fakeThing', mount: 'mountThing', noun: 'things', isGone: () => false, freshMs: 1000, now: () => clock });
    lazy.show();
    await flush();
    clock = 500;
    lazy.show();
    assert.equal(refreshed.length, 0, 'still fresh');
    clock = 1500;
    lazy.show();
    assert.equal(refreshed.length, 1, 'stale: refreshed in place');
    lazy.show();
    assert.equal(refreshed.length, 1, 'the refresh restarted the clock');
    lazy.remount();
    await flush();
    assert.equal(unmounted.length, 1, 'remount unmounts the old one');
    lazy.dispose();
    assert.equal(unmounted.length, 2);
  } finally {
    delete UI_LOADERS.fakeThing;
  }
});

test('whenIdle uses requestIdleCallback when present and a timer otherwise; both can be cancelled', async () => {
  const { whenIdle } = await import('./idle-task.js');
  const seen = [];
  const win = { requestIdleCallback: (fn, o) => { seen.push(o.timeout); fn(); return 7; }, cancelIdleCallback: (id) => seen.push(`cancel ${id}`) };
  let ran = 0;
  whenIdle(() => { ran += 1; }, win)();
  assert.equal(ran, 1);
  assert.deepEqual(seen, [1500, 'cancel 7']);
  let timed = 0;
  const cancel = whenIdle(() => { timed += 1; }, {});
  cancel();
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(timed, 0, 'cancelled');
  whenIdle(() => { timed += 1; }, {});
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(timed, 1);
});

test('rows of the hidden songs pane are rebuilt once when the browser is idle, before Songs is clicked', async () => {
  const v = setup('#/library');
  await flush();
  location.hash = '#/library/albums';
  v.cleanup.retarget();
  store.songs = [...SONGS, { id: 'c', title: 'Gamma', artist: 'Xi', file: 'c.mp3', duration: 9, added_at: '2024-04-01', tags: [] }];
  store.listeners.forEach((fn) => fn());
  store.listeners.forEach((fn) => fn());
  assert.equal(v.rows().length, 2);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(v.rows().length, 3, 'rebuilt while still hidden');
  const built = [...v.rows()];
  location.hash = '#/library';
  v.cleanup.retarget();
  assert.ok([...v.rows()].every((row, i) => row === built[i]), 'showing Songs does not rebuild again');
  v.cleanup();
});
