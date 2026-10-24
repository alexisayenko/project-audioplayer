import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const calls = stubFetch((url, o) => {
  if (url === '/library') return { body: { songs: SONGS } };
  if (url === '/songs/n1/audio' && o.method === 'POST') return { status: 500, body: { detail: 'nope' } };
  return { body: {} };
});
const { store, tagCounts } = await import('./store.js');
const { renderLibrary, visibleSongs, filterByTags } = await import('./library.js');
const { unsetKey, unsetCount } = await import('./library-data.js');
const { categoryTags, tagLabel } = await import('./tagname.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { requestReveal } = await import('./reveal.js');
const { setAutoDownload } = await import('./autodl.js');
await import('./library-toolbar.js');
await import('./song-card.js');
await import('./edit-dialog.js');

const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', year: 1999, bpm: 120, file: 'a.mp3', duration: 125, added_at: '2024-01-01', tags: ['genre:rock', 'country:de', 'decade:90s'] },
  { id: 'b', title: 'beta', artist: 'Yan', year: 2005, file: 'b.mp3', duration: 61, added_at: '2024-03-01', tags: ['genre:jazz', 'country:fr', 'decade:00s', 'chill'] },
  { id: 'c', title: 'Gamma', artist: 'Xi', file: 'c.mp3', duration: 0, added_at: '2024-02-01', tags: ['genre:rock', 'chill'] },
  { id: 'n1', title: 'Offline', artist: 'Wu', file: null, audio_state: 'none', added_at: '2023-01-01', tags: [], sources: [{ source: 'youtube', url: 'https://youtu.be/x' }] },
];
const setStore = (songs, loaded = true) => {
  store.songs = songs;
  store.loaded = loaded;
  store.pending = null;
  store.loadedAt = 0;
  store.tags = [];
  const counts = new Map();
  for (const s of songs) for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  store.tags = [...counts].map(([tag, count]) => ({ tag, count }));
};

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderLibrary(root);
  const rows = () => root.querySelectorAll('li.song');
  const titles = () => rows().map((r) => r.querySelector('.open').textContent);
  const search = (v) => { const i = root.querySelector('input[type=search]'); i.value = v; i.dispatchEvent(makeEvent('input', { target: i })); };
  return { root, cleanup, rows, titles, search };
}

test('while loading it shows a loading note and no table', () => {
  setStore([], false);
  stubFetch(() => new Promise(() => {}));
  const { root, cleanup } = mount();
  assert.match(root.textContent, /Loading your library/);
  cleanup();
});

test('a failed load shows the error and Retry reloads', async () => {
  setStore([], false);
  stubFetch(() => ({ status: 500, body: { detail: 'db down' } }));
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /db down/);
  stubFetch(() => ({ body: { songs: SONGS } }));
  root.querySelector('.state button').click();
  await flush();
  assert.equal(root.querySelectorAll('li.song').length, 4);
  cleanup();
});

test('an empty library invites adding a song', async () => {
  setStore([]);
  stubFetch(() => ({ body: { songs: [] } }));
  const { root, cleanup } = mount();
  await flush();
  assert.match(root.textContent, /No songs yet/);
  assert.equal(root.querySelectorAll('li.song').length, 0);
  cleanup();
});

test('rows are sorted by recently added; counts, durations and BPM are shown', async () => {
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, cleanup, rows } = mount();
  await flush();
  assert.deepEqual(titles(), ['beta', 'Gamma', 'Alpha', 'Offline']);
  assert.match(root.textContent, /4 songs/);
  const alpha = rows().find((r) => r.dataset.id === 'a');
  assert.equal(alpha.querySelector('.c-dur'), null);
  assert.equal(alpha.querySelector('.title-line').children.at(-1), alpha.querySelector('.title-len'), 'the length is the rightmost item');
  assert.equal(alpha.firstElementChild, alpha.querySelector('.row-acts'), 'the action column comes first in the row, before the cover');
  assert.equal(alpha.querySelector('.title-line .sq-btn'), null, 'the queue button is not on the title line');
  assert.equal(alpha.querySelector('.row-acts .act-queue').getAttribute('aria-pressed'), 'false');
  assert.equal(alpha.querySelector('.row-acts .act-queue').title, 'Add to queue');
  assert.equal(alpha.querySelector('.sub').textContent, 'Zed · 1999');
  assert.equal(alpha.querySelector('.title-line .title-len').textContent, '2:05');
  assert.equal(alpha.querySelector('.bpm-badge').getAttribute('aria-label'), 'BPM 120');
  assert.equal(alpha.querySelector('.sub').getAttribute('title'), alpha.querySelector('.sub').textContent);
  assert.equal(alpha.querySelector('.c-genres .g-txt').textContent, 'rock');
  assert.equal(alpha.querySelector('.c-genres .g-txt').getAttribute('title'), 'rock');
  assert.equal(alpha.querySelector('.c-genres .bpm-badge'), null, 'the badge is not in the Genres cell');
  assert.ok(alpha.querySelector('.sub-line > .sub-end > .bpm-badge'), 'badge ends the subtitle line');
  assert.equal(alpha.querySelector('.sub-end').children.at(-1), alpha.querySelector('.bpm-badge'));
  assert.equal(alpha.querySelector('.bpm-slot'), null);
  assert.equal(alpha.querySelector('.title-line .bpm-badge'), null);
  const offline = rows().find((r) => r.dataset.id !== 'a' && !r.querySelector('.bpm-badge'));
  assert.ok(offline, 'a row without BPM has no badge');
  assert.equal(offline.querySelector('.bpm-slot'), null, 'no reserved slot');
  assert.equal(offline.querySelector('.sub-end .bpm-badge'), null);
  const off = rows().find((r) => r.classList.contains('no-audio'));
  assert.equal(off.querySelector('.c-dur'), null, 'no right-hand cell any more');
  assert.equal(off.querySelector('.title-len'), null);
  cleanup();
});

test('search matches the remix field: whole string, each token, case-insensitive; other fields unchanged', async () => {
  const songs = [
    { id: 'r1', title: 'One', artist: 'Aa', remixer: 'Tiesto - Armin Van Buuren', file: 'r1.mp3', added_at: '2024-01-01', tags: [] },
    { id: 'r2', title: 'Two', artist: 'Bb', remixer: '', file: 'r2.mp3', added_at: '2024-01-02', tags: [] },
    { id: 'r3', title: 'Three', artist: 'Cc', file: 'r3.mp3', added_at: '2024-01-03', tags: ['chill'] },
  ];
  setStore(songs);
  stubFetch(() => ({ body: { songs } }));
  const { search, cleanup } = mount();
  await flush();
  const ids = () => visibleSongs().map((s) => s.id).sort();
  search('tiesto');
  assert.deepEqual(ids(), ['r1']);
  search('ARMIN van');
  assert.deepEqual(ids(), ['r1']);
  search('tiesto - armin');
  assert.deepEqual(ids(), ['r1']);
  search('remix');
  assert.deepEqual(ids(), []);
  search('two');
  assert.deepEqual(ids(), ['r2']);
  search('cc');
  assert.deepEqual(ids(), ['r3']);
  search('chill');
  assert.deepEqual(ids(), ['r3']);
  search('');
  cleanup();
});

test('search matches title, artist and tag text case-insensitively; no match shows a hint', async () => {
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, search, cleanup } = mount();
  await flush();
  search('ZED');
  assert.deepEqual(titles(), ['Alpha']);
  search('chill');
  assert.deepEqual(titles(), ['beta', 'Gamma']);
  search('zzzz');
  assert.deepEqual(titles(), []);
  assert.match(root.textContent, /No songs match/);
  search('');
  assert.equal(titles().length, 4);
  cleanup();
});

test('sorting by title/artist/year changes the order', async () => {
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, cleanup } = mount();
  await flush();
  const sort = root.querySelector('select');
  const pick = (v) => { sort.value = v; sort.dispatchEvent(makeEvent('change', { target: sort })); };
  pick('title');
  assert.deepEqual(titles(), ['Alpha', 'beta', 'Gamma', 'Offline']);
  pick('artist');
  assert.deepEqual(titles(), ['Offline', 'Gamma', 'beta', 'Alpha']);
  pick('year');
  assert.deepEqual(titles().slice(0, 2), ['beta', 'Alpha']);
  pick('length');
  assert.deepEqual(titles(), ['beta', 'Alpha', 'Gamma', 'Offline']);
  const rev = root.querySelector('.sort-reverse');
  assert.equal(rev.getAttribute('aria-pressed'), 'false');
  rev.dispatchEvent(makeEvent('click', { target: rev }));
  assert.equal(rev.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(titles(), ['Alpha', 'beta', 'Gamma', 'Offline'], 'Length reversed: longest first, songs without a duration still last');
  pick('title');
  assert.deepEqual(titles(), ['Offline', 'Gamma', 'beta', 'Alpha']);
  rev.dispatchEvent(makeEvent('click', { target: rev }));
  assert.equal(rev.getAttribute('aria-pressed'), 'false');
  pick('added');
  cleanup();
});

test('category chips: counts, disabled when empty, filter sheet applies and clears a selection', async () => {
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, cleanup } = mount();
  await flush();
  const chips = root.querySelectorAll('.cat-chip');
  assert.deepEqual(chips.map((c) => c.getAttribute('aria-label')), ['Tags, 1', 'Genres, 2', 'Years, 2', 'Countries, 2']);
  const genres = chips[1];
  genres.click(); await flush();
  const sheet = document.getElementById('filter-sheet');
  assert.equal(sheet.open, true);
  const rock = sheet.querySelectorAll('.pills button').find((b) => b.getAttribute('title') === 'genre:rock');
  rock.click();
  assert.equal(rock.getAttribute('aria-pressed'), 'true');
  assert.equal(sheet.querySelector('.btn.primary'), null, 'no Show button: the selection applies as you tap');
  assert.equal(sheet.open, true);
  assert.deepEqual(titles(), ['Gamma', 'Alpha']);
  assert.match(sheet.querySelector('.sheet-head p').textContent, /1 selected · 2 songs/);
  sheet.close();
  assert.match(root.querySelector('[role=status]').textContent, /2 songs match · rock/);
  assert.equal(root.querySelectorAll('.cat-chip')[1].getAttribute('aria-label'), 'Genres, 1 selected');
  root.querySelectorAll('.cat-chip')[1].click(); await flush();
  sheet.querySelector('.sheet-head button').click();
  assert.equal(titles().length, 4, 'Clear applies at once');
  assert.equal(sheet.open, true);
  sheet.close();
  cleanup();
});

test('selections in different categories AND together; within one they OR', async () => {
  setStore(SONGS);
  filterByTags(['genre:rock', 'genre:jazz']);
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['a', 'b', 'c']);
  filterByTags(['genre:rock', 'country:de']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['a']);
  filterByTags(['genre:nonexistent']);
  assert.equal(visibleSongs().length, 4, 'unknown tags are ignored');
  filterByTags([]);
});

test('"not set" system entry: counts, OR within a facet, AND across facets, not a real tag', async () => {
  setStore(SONGS);
  assert.equal(unsetKey('genres'), 'genre:__unset__');
  assert.equal(unsetKey('tags'), null);
  assert.deepEqual(['genres', 'years', 'countries'].map((c) => unsetCount(c)), [1, 2, 2]);
  filterByTags(['genre:__unset__']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['n1']);
  filterByTags(['genre:__unset__', 'genre:rock']);
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['a', 'c', 'n1']);
  filterByTags(['country:__unset__', 'genre:rock']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['c']);
  filterByTags(['decade:__unset__']);
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['c', 'n1']);
  filterByTags(['tags:__unset__', 'foo:__unset__']);
  assert.equal(visibleSongs().length, 4, 'unknown tokens are ignored');
  assert.equal(store.tags.some((t) => t.tag.includes('__unset__')), false);
  assert.equal(categoryTags(store.tags, 'genres').some((t) => t.tag.includes('__unset__')), false);
  filterByTags([]);
});

test('Years filter is derived from each song year, not from decade tags', async () => {
  const YEARS = [
    { id: 'y99', title: 'Y99', releaseYear: 1999, file: 'a.mp3', tags: [] },
    { id: 'y00', title: 'Y00', releaseYear: 2000, file: 'b.mp3', tags: ['decade:90s'] },
    { id: 'v2', title: 'V2', releaseYear: 1990, file: 'c.mp3', tags: ['decade:00s'], version: { type: 'remix', name: 'X Remix', releaseYear: 1984 } },
    { id: 'old', title: 'Old', releaseYear: 1949, file: 'd.mp3', tags: ['decade:40s'] },
    { id: 'none', title: 'None', file: 'e.mp3', tags: ['decade:90s'] },
  ];
  const load = () => { store.songs = YEARS; store.loaded = true; store.tags = tagCounts(YEARS); };
  load();
  assert.deepEqual(categoryTags(store.tags, 'years').map((t) => [tagLabel(t.tag), t.count]), [['the 80s', 1], ['the 90s', 1], ['the 00s', 1]]);
  assert.equal(unsetCount('years'), 2);
  filterByTags(['decade:90s']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['y99']);
  filterByTags(['decade:00s']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['y00'], 'a stored decade tag with another year does not count');
  filterByTags(['decade:80s', 'decade:00s']);
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['v2', 'y00']);
  filterByTags(['decade:__unset__']);
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['none', 'old']);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: YEARS } }));
  const { root, titles, cleanup } = mount();
  await flush();
  const chips = root.querySelectorAll('.cat-chip');
  assert.equal(chips[2].getAttribute('aria-label'), 'Years, 3');
  chips[2].click(); await flush();
  const sheet = document.getElementById('filter-sheet');
  const pills = sheet.querySelectorAll('.pills button');
  assert.deepEqual(pills.filter((b) => !b.classList.contains('unset')).map((b) => b.getAttribute('title')), ['decade:80s', 'decade:90s', 'decade:00s']);
  pills.find((b) => b.getAttribute('title') === 'decade:90s').click();
  assert.deepEqual(titles(), ['Y99']);
  sheet.close();
  filterByTags([]);
  cleanup();
});

test('"not set" pill in the filter sheet: first, italic, chip count stays real, summary names it', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, cleanup } = mount();
  await flush();
  const chips = root.querySelectorAll('.cat-chip');
  assert.equal(chips[1].getAttribute('aria-label'), 'Genres, 2');
  chips[1].click(); await flush();
  const sheet = document.getElementById('filter-sheet');
  const first = sheet.querySelector('.pills button');
  assert.equal(first.getAttribute('aria-label'), 'Songs with no genre');
  assert.match(first.textContent, /not set1/);
  first.click();
  assert.deepEqual(titles(), ['Offline']);
  sheet.close();
  assert.match(root.querySelector('[role=status]').textContent, /Genres: not set/);
  assert.equal(root.querySelectorAll('.cat-chip')[1].getAttribute('aria-label'), 'Genres, 1 selected');
  filterByTags([]);
  cleanup();
});

test('Play all replaces the queue with the visible songs that have audio; Add all appends', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, cleanup, search } = mount();
  await flush();
  search('a');
  const bar = [...root.querySelectorAll('.sortbar .sort-actions button')];
  const playAll = bar.find((b) => /^Play all/.test(b.textContent));
  const addAll = bar.find((b) => /^Add all/.test(b.textContent));
  assert.match(playAll.textContent, /^Play all \d/);
  playAll.click();
  assert.equal(player.current.id !== 'n1', true);
  assert.equal(document.getElementById('toast').textContent, 'Playing 3 songs');

  addAll.click();
  assert.equal(document.getElementById('toast').textContent, 'Added 0 songs (3 already in queue)');
  cleanup();
});

test('no-audio rows show a Download button and no source logo; clicking requests it and shows the failure ring', async () => {
  setStore(SONGS);
  filterByTags([]);
  const c = stubFetch((url, o) => {
    if (url === '/library') return { body: { songs: SONGS } };
    if (o.method === 'POST') return { status: 500, body: { detail: 'nope' } };
    return { body: {} };
  });
  const { rows, cleanup } = mount();
  await flush();
  const row = rows().find((r) => r.dataset.id === 'n1');
  assert.ok(row.classList.contains('no-audio'));
  assert.equal(row.querySelector('a.src-youtube'), null, 'the source logo is gone from rows');
  assert.equal(row.querySelector('.title-line').children.at(-1), row.querySelector('.title-line .sq-btn'));
  assert.equal(row.querySelector('.title-line .sq-btn').title, 'Download to the server', 'no length: the button sits alone at the end of the title line');
  assert.equal(row.querySelector('.title-line').children.length, 2);
  assert.equal(row.querySelector('.open').localName, 'button', 'the title opens the song card');
  assert.equal(row.querySelector('.row-cover').getAttribute('aria-label'), 'Download Offline', 'with Auto-download off the cover downloads');
  assert.ok(row.querySelector('.title-line .sq-btn').classList.contains('icon'), 'download is an icon button');
  row.querySelector('.title-line .sq-btn').click();
  await flush();
  assert.ok(c.some((x) => x.url === '/songs/n1/audio' && x.opts.method === 'POST'));
  const again = rows().find((r) => r.dataset.id === 'n1');
  assert.ok(again.querySelector('button.dl-ring.failed'), 'a failed download shows a retry button');
  cleanup();
});

test('with auto-download on, no-audio songs become playable rows', async () => {
  setAutoDownload(true);
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  const row = rows().find((r) => r.dataset.id === 'n1');
  assert.equal(row.querySelector('.open').localName, 'button');
  setAutoDownload(false);
  cleanup();
});

test('row state button toggles the queue inline; the row has no More menu', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  while (player.current) player.removeAt(0);
  const find = () => rows().find((r) => r.dataset.id === 'b');
  const row = find();
  assert.equal(row.querySelector('.pl-toggle'), null, 'ER1: no playlist toggle button on the row');
  assert.equal(row.querySelector('.more'), null, 'the row has no More menu (the song card has every action)');
  assert.equal(row.querySelector('.act-queue.on'), null, 'not queued: the button is not pressed');
  assert.equal(row.querySelector('.act-queue').getAttribute('aria-pressed'), 'false');
  row.querySelector('.act-queue').click();
  assert.equal(player.inQueue('b'), true, 'the row button adds to the queue');
  const queuedRow = find();
  const qi = queuedRow.querySelector('.row-acts .act-queue.on');
  assert.ok(qi, 'queued: the action column holds the pressed queue button');
  assert.equal(qi.getAttribute('aria-pressed'), 'true');
  assert.equal(qi.title, 'In the queue, position 1 of 1. Click to remove');
  assert.match(qi.getAttribute('aria-label'), /^Remove from queue/);
  assert.equal(qi.parentNode.lastElementChild, qi, 'the queue button sits below the playlist button, left of the cover');
  assert.equal(qi.parentNode.nextElementSibling, queuedRow.querySelector('.row-cover'));
  assert.equal(queuedRow.querySelector('.q-mark'), null, 'no cover badge');
  assert.match(queuedRow.querySelector('.row-cover').getAttribute('aria-description'), /In the queue, position 1 of 1$/);
  assert.match(queuedRow.querySelector('.row-cover').title, /In the queue, position 1 of 1$/);
  assert.notEqual(document.getElementById('toast').textContent, 'Queued', 'WEB-115: inline feedback, no toast');
  qi.click();
  assert.equal(player.inQueue('b'), false, 'and removes it');
  assert.equal(find().querySelector('.act-queue.on'), null, 'removed: the button is not pressed');
  while (player.current) player.removeAt(0);
  cleanup();
});

test('tapping a row opens the song card, but not the cover or the state button', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  const card = document.getElementById('song-card');
  const row = () => rows().find((r) => r.dataset.id === 'a');
  for (const sel of ['.act-queue', '.row-cover']) {
    row().querySelector(sel).click();
    assert.equal(card.open, false, sel);
    document.body.querySelectorAll('.menu').forEach((m) => m.remove());
    while (player.current) player.removeAt(0);
  }
  row().querySelector('.info').dispatchEvent(makeEvent('click', { bubbles: true })); await flush();
  assert.equal(card.open, true);
  assert.equal(card.querySelector('h2').textContent, 'Alpha');
  card.close();
  row().querySelector('.open').click(); await flush();
  assert.equal(card.open, true, 'the title button opens it too');
  card.close();
  rows().find((r) => r.dataset.id === 'b').querySelector('.act-queue').click();
  while (player.current) player.removeAt(0);
  assert.equal(card.open, false);
  cleanup();
});

test('the cover button plays now, shows Pause on the playing song and Play when paused', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  while (player.current) player.removeAt(0);
  const cover = (id) => rows().find((r) => r.dataset.id === id).querySelector('.row-cover');
  assert.equal(cover('b').getAttribute('aria-label'), 'Play beta');
  assert.equal(cover('b').classList.contains('persist'), false);
  cover('b').focus();
  cover('b').click();
  assert.equal(player.current.id, 'b');
  assert.equal(player.playing, true);
  assert.equal(cover('b').getAttribute('aria-label'), 'Pause beta');
  assert.equal(cover('b').classList.contains('persist'), true);
  assert.equal(cover('a').getAttribute('aria-label'), 'Play Alpha');
  assert.ok(document.activeElement === cover('b'), 'the rebuilt cover keeps keyboard focus');
  cover('b').click();
  assert.equal(player.playing, false);
  assert.equal(cover('b').getAttribute('aria-label'), 'Play beta');
  assert.equal(cover('b').classList.contains('persist'), true);
  while (player.current) player.removeAt(0);
  cleanup();
});

test('a player state change keeps the loaded cover images and still repaints the row state', async () => {
  const covered = SONGS.slice(0, 3).map((s) => ({ ...s, cover: true, cover_v: 'v1' }));
  setStore(covered);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: covered } }));
  const { rows, cleanup } = mount();
  await flush();
  while (player.current) player.removeAt(0);
  const imgs = () => rows().map((r) => r.querySelector('.row-cover img.cover'));
  const before = imgs();
  assert.equal(before.length, 3);
  assert.ok(before.every((i) => i.getAttribute('src')?.startsWith('/covers/')));
  player.playNow('b');
  assert.deepEqual(imgs(), before, 'covers survive the song change');
  player.toggle();
  assert.deepEqual(imgs(), before, 'covers survive pause');
  player.toggle();
  assert.deepEqual(imgs(), before, 'covers survive play');
  const row = rows().find((r) => r.dataset.id === 'b');
  assert.equal(row.classList.contains('current'), true);
  assert.equal(row.querySelector('.row-cover').getAttribute('aria-label'), 'Pause beta');
  assert.ok(before.every((i) => i.parentNode?.classList.contains('row-cover')));
  while (player.current) player.removeAt(0);
  cleanup();
});

test('reveal scrolls to a visible row and flashes it; hidden-by-filter offers Show', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup, search, titles } = mount();
  await flush();
  requestReveal('a');
  assert.ok(rows().find((r) => r.dataset.id === 'a').classList.contains('flash'));
  search('Gamma');
  requestReveal('a');
  const toast = document.getElementById('toast');
  assert.match(toast.textContent, /hidden by the current filters/);
  toast.querySelector('button').click();
  assert.equal(titles().length, 4);
  requestReveal('does-not-exist');
  cleanup();
});

test('cleanup unregisters the revealer and closes an open sheet', async () => {
  setStore(SONGS);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, cleanup } = mount();
  await flush();
  root.querySelectorAll('.cat-chip')[1].click(); await flush();
  assert.equal(document.getElementById('filter-sheet').open, true);
  cleanup();
  assert.equal(document.getElementById('filter-sheet').open, false);
});

test('Clear filters appears with a search or a filter and resets both at once', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { root, titles, cleanup, search } = mount();
  await flush();
  const clear = () => [...root.querySelectorAll('.sortbar .sort-actions button')].find((b) => b.textContent === 'Clear filters');
  assert.equal(clear().hidden, true, 'hidden while nothing is filtered');
  search('alp');
  assert.equal(clear().hidden, false);
  assert.deepEqual(titles(), ['Alpha']);
  root.querySelectorAll('.cat-chip')[1].click(); await flush();
  const sheet = document.getElementById('filter-sheet');
  sheet.querySelectorAll('.pills button').find((b) => b.getAttribute('title') === 'genre:rock').click();
  sheet.close();
  clear().click();
  assert.equal(root.querySelector('input[type=search]').value, '');
  assert.equal(titles().length, 4, 'search and genre filter are both gone');
  assert.equal(clear().hidden, true);
  assert.equal(root.querySelectorAll('.cat-chip')[1].getAttribute('aria-label'), 'Genres, 2');
  cleanup();
});

test('Show playing sits on the Library toolbar only while a song is current and reveals its row', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  while (player.current) player.removeAt(0);
  const { root, cleanup } = mount();
  await flush();
  const show = () => [...root.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Show playing');
  assert.equal(show().hidden, true, 'nothing is current');
  assert.equal(show().parentElement.className, 'toolbar', 'beside the search, not in the sort bar actions');
  assert.deepEqual([...root.querySelectorAll('.sortbar .sort-actions button')].map((b) => b.textContent.replace(/ \d+.*/, '')), ['Clear filters', 'Play all', 'Add all']);
  player.playNow('a');
  assert.equal(show().hidden, false);
  assert.equal(show().getAttribute('aria-label'), 'Show the playing song in the list');
  show().click();
  assert.ok(root.querySelector('li.song[data-id="a"]').classList.contains('flash'), 'the playing row is revealed and flashed');
  while (player.current) player.removeAt(0);
  cleanup();
});

test('the search clear button: hidden when empty, shown on input, click clears, refocuses and refreshes the list', () => {
  setStore(SONGS);
  const { root, cleanup, titles, search } = mount();
  const input = root.querySelector('input[type=search]');
  const btn = root.querySelector('.search-clear');
  assert.equal(btn.getAttribute('aria-label'), 'Clear search');
  assert.equal(btn.getAttribute('title'), 'Clear search');
  assert.equal(btn.hidden, true);
  search('alp');
  assert.equal(btn.hidden, false);
  assert.deepEqual(titles(), ['Alpha']);
  assert.match(root.querySelector('[role=status]').textContent, /1 song matches/);
  btn.click();
  assert.equal(input.value, '');
  assert.equal(btn.hidden, true);
  assert.equal(titles().length, 4);
  assert.equal(root.querySelector('[role=status]').textContent, '', 'the match counter is gone with the query');
  assert.ok(document.activeElement === input, 'focus returns to the search box');
  cleanup();
});

test('Escape in the search box clears it only when it has text', () => {
  setStore(SONGS);
  const { root, cleanup, titles, search } = mount();
  const input = root.querySelector('input[type=search]');
  const esc = () => { const e = makeEvent('keydown', { key: 'Escape' }); input.dispatchEvent(e); return e; };
  assert.equal(esc().defaultPrevented, false, 'empty box: Escape is left alone');
  search('alp');
  assert.equal(esc().defaultPrevented, true);
  assert.equal(input.value, '');
  assert.equal(titles().length, 4);
  assert.equal(root.querySelector('.search-clear').hidden, true);
  cleanup();
});

test('WEB-116: opening the Library right after a load reuses the loaded songs instead of fetching again', async () => {
  setStore(SONGS);
  store.loadedAt = Date.now();
  const fresh = stubFetch(() => ({ body: { songs: SONGS } }));
  const first = mount();
  await flush();
  assert.equal(fresh.length, 0);
  assert.equal(first.rows().length, 4);
  first.cleanup();
  store.loadedAt = 0;
  const again = mount();
  await flush();
  assert.equal(fresh.filter((c) => c.url === '/library').length, 1, 'older data is refreshed');
  again.cleanup();
});
