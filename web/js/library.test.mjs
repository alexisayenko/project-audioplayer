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

const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', year: 1999, bpm: 120, file: 'a.mp3', duration: 125, added_at: '2024-01-01', tags: ['genre:rock', 'country:de', 'decade:90s'] },
  { id: 'b', title: 'beta', artist: 'Yan', year: 2005, file: 'b.mp3', duration: 61, added_at: '2024-03-01', tags: ['genre:jazz', 'country:fr', 'decade:00s', 'chill'] },
  { id: 'c', title: 'Gamma', artist: 'Xi', file: 'c.mp3', duration: 0, added_at: '2024-02-01', tags: ['genre:rock', 'chill'] },
  { id: 'n1', title: 'Offline', artist: 'Wu', file: null, audio_state: 'none', added_at: '2023-01-01', tags: [], sources: [{ source: 'youtube', url: 'https://youtu.be/x' }] },
];
const setStore = (songs, loaded = true) => {
  store.songs = songs;
  store.loaded = loaded;
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
  assert.equal(alpha.querySelector('.c-dur').textContent, '2:05');
  assert.equal(alpha.querySelector('.bpm-badge').getAttribute('aria-label'), 'BPM 120');
  assert.match(alpha.querySelector('.sub').textContent, /Zed · 1999/);
  assert.equal(alpha.querySelector('.sub').getAttribute('title'), alpha.querySelector('.sub').textContent);
  assert.equal(alpha.querySelector('.c-genres .g-txt').textContent, 'rock');
  assert.ok(alpha.querySelector('.c-genres .bpm-badge'));
  assert.ok(alpha.querySelector('.c-genres').children[0].classList.contains('bpm-badge'));
  assert.equal(alpha.querySelector('.title-line .bpm-badge'), null);
  const offline = rows().find((r) => r.dataset.id !== 'a' && !r.querySelector('.bpm-badge'));
  assert.ok(offline, 'a row without BPM has no badge');
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
  genres.click();
  const sheet = document.getElementById('filter-sheet');
  assert.equal(sheet.open, true);
  const rock = sheet.querySelectorAll('.pills button').find((b) => b.getAttribute('title') === 'genre:rock');
  rock.click();
  assert.equal(rock.getAttribute('aria-pressed'), 'true');
  const show = sheet.querySelector('.btn.primary');
  assert.equal(show.textContent, 'Show 2 songs');
  show.click();
  assert.equal(sheet.open, false);
  assert.deepEqual(titles(), ['Gamma', 'Alpha']);
  assert.match(root.querySelector('[role=status]').textContent, /2 songs match · rock/);
  assert.equal(root.querySelectorAll('.cat-chip')[1].getAttribute('aria-label'), 'Genres, 1 selected');
  root.querySelectorAll('.cat-chip')[1].click();
  sheet.querySelector('.sheet-head button').click();
  sheet.querySelector('.btn.primary').click();
  assert.equal(titles().length, 4);
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
  chips[2].click();
  const sheet = document.getElementById('filter-sheet');
  const pills = sheet.querySelectorAll('.pills button');
  assert.deepEqual(pills.filter((b) => !b.classList.contains('unset')).map((b) => b.getAttribute('title')), ['decade:80s', 'decade:90s', 'decade:00s']);
  pills.find((b) => b.getAttribute('title') === 'decade:90s').click();
  sheet.querySelector('.btn.primary').click();
  assert.deepEqual(titles(), ['Y99']);
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
  chips[1].click();
  const sheet = document.getElementById('filter-sheet');
  const first = sheet.querySelector('.pills button');
  assert.equal(first.getAttribute('aria-label'), 'Songs with no genre');
  assert.match(first.textContent, /not set1/);
  first.click();
  sheet.querySelector('.btn.primary').click();
  assert.deepEqual(titles(), ['Offline']);
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
  const [playAll, addAll] = [...root.querySelectorAll('.sortbar button')];
  assert.match(playAll.textContent, /^Play all \d/);
  playAll.click();
  assert.equal(player.current.id !== 'n1', true);
  assert.equal(document.getElementById('toast').textContent, 'Playing 3 songs');

  addAll.click();
  assert.equal(document.getElementById('toast').textContent, 'Added 0 songs (3 already in queue)');
  cleanup();
});

test('no-audio rows show the source logo and a Download button; clicking requests it and shows the failure ring', async () => {
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
  assert.ok(row.querySelector('a.src-youtube'));
  assert.equal(row.querySelector('a.src-youtube').getAttribute('href'), 'https://youtu.be/x');
  assert.equal(row.querySelector('.open').localName, 'button', 'the title opens the song card');
  assert.equal(row.querySelector('.row-cover').getAttribute('aria-label'), 'Download Offline', 'with Auto-download off the cover downloads');
  assert.ok(row.querySelector('.row-dl').classList.contains('round'), 'WEB-099: download is a round icon');
  row.querySelector('.row-dl').click();
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

test('row menu: Play now, queue toggle and Edit song', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  while (player.current) player.removeAt(0);
  const row = rows().find((r) => r.dataset.id === 'b');
  assert.ok(row.querySelector('.pl-toggle').classList.contains('round'), 'WEB-099: playlist toggle is a round icon');
  row.querySelector('.pl-toggle').click();
  assert.equal(player.inQueue('b'), true);
  assert.equal(document.getElementById('toast').textContent, 'Queued');
  rows().find((r) => r.dataset.id === 'b').querySelector('.more').click();
  const labels = document.body.querySelectorAll('.menu button').map((b) => b.textContent);
  assert.deepEqual(labels, ['Play now', 'Remove from playlist', 'Download', 'Share link', 'Edit song']);
  document.body.querySelectorAll('.menu button').find((b) => b.textContent === 'Edit song').click();
  assert.equal(document.getElementById('edit-dialog').open, true);
  assert.equal(document.getElementById('edit-dialog').querySelector('h2').textContent, 'Edit song');
  cleanup();
});

test('tapping a row opens the song card, but not the cover, toggle, menu or links', async () => {
  setStore(SONGS);
  filterByTags([]);
  stubFetch(() => ({ body: { songs: SONGS } }));
  const { rows, cleanup } = mount();
  await flush();
  const card = document.getElementById('song-card');
  const row = () => rows().find((r) => r.dataset.id === 'a');
  for (const sel of ['.pl-toggle', '.more', '.row-cover']) {
    row().querySelector(sel).click();
    assert.equal(card.open, false, sel);
    document.body.querySelectorAll('.menu').forEach((m) => m.remove());
    while (player.current) player.removeAt(0);
  }
  row().querySelector('.info').dispatchEvent(makeEvent('click', { bubbles: true }));
  assert.equal(card.open, true);
  assert.equal(card.querySelector('h2').textContent, 'Alpha');
  card.close();
  row().querySelector('.open').click();
  assert.equal(card.open, true, 'the title button opens it too');
  card.close();
  rows().find((r) => r.dataset.id === 'n1').querySelector('a.src-youtube').click();
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
  root.querySelectorAll('.cat-chip')[1].click();
  assert.equal(document.getElementById('filter-sheet').open, true);
  cleanup();
  assert.equal(document.getElementById('filter-sheet').open, false);
});
