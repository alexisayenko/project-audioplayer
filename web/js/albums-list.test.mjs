import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer, player } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { prefs, LIBRARY_PREFS_KEY, savePrefs, loadPrefs } = await import('./library-data.js');
const model = await import('./albums-model.js');
const { mountAlbums, openAlbumEdit } = await import('./albums.js');

const ok = (body, status = 200) => ({ status, body });
const mk = (id, extra = {}) => ({ id, title: id, artist: 'Band', year: 2000, trackCount: 1, created_at: `2026-10-0${id.length}T10:00:00Z`, genres: [], source: 'discogs:1', links: {}, tracks: [{ no: 1, title: `${id}-track`, durationS: 100, songId: null }], ...extra });
const A = mk('Alpha', { year: 1999, genres: ['House'], created_at: '2026-10-01T00:00:00Z', tracks: [{ no: 1, title: 'Opener', durationS: 100, songId: 's1' }, { no: 2, title: 'Closer', durationS: 300, songId: 's2' }] });
const B = mk('Bravo', { year: 2004, artist: 'Zed', genres: ['Techno'], created_at: '2026-10-03T00:00:00Z', tracks: [{ no: 1, title: 'Hidden gem', durationS: 50, songId: null }] });
const C = mk('Charlie', { year: null, genres: ['House', 'Dub'], created_at: '2026-10-02T00:00:00Z', tracks: [{ no: 1, title: 'Third', durationS: 900, songId: null }, { no: 2, title: 'Third b', durationS: 100, songId: null }] });
const ALL = [A, B, C];

function reset() {
  prefs.query = '';
  model.albumPrefs.sort = 'added';
  model.albumPrefs.reverse = false;
  model.albumPrefs.sel.genres.clear();
  model.albumPrefs.sel.years.clear();
  localStorage.clear();
  store.songs = [
    { id: 's1', title: 'Opener', artist: 'Band', file: 's1.mp3', duration: 100, bpm: 120 },
    { id: 's2', title: 'Closer', artist: 'Band', file: 's2.mp3', duration: 300, bpm: 126 },
  ];
}

async function open(list = ALL) {
  reset();
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch((u, o) => {
    if (u === '/albums') return ok(list.map(({ tracks, ...r }) => ({ ...r, trackCount: tracks.length })));
    const hit = list.find((a) => u === `/albums/${a.id}`);
    if (hit && !o.method || (hit && o.method === 'GET')) return ok(hit);
    return ok({});
  });
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  const names = () => [...pane.querySelectorAll('li.album-row')].map((r) => r.dataset.id);
  return { pane, calls, unmount, names, q: (s) => pane.querySelector(s) };
}
const typeSearch = (v, text) => { const i = v.q('.toolbar input[type=search]'); i.value = text; fire(i, 'input'); };

test('search matches album title, artist, genre and track titles with the shared prefs.query', async () => {
  const v = await open();
  assert.equal(v.q('.toolbar input[type=search]').getAttribute('placeholder'), 'Search album, artist, genre or track');
  typeSearch(v, 'alp');
  assert.deepEqual(v.names(), ['Alpha']);
  typeSearch(v, 'zed');
  assert.deepEqual(v.names(), ['Bravo']);
  typeSearch(v, 'dub');
  assert.deepEqual(v.names(), ['Charlie']);
  typeSearch(v, 'HIDDEN');
  assert.deepEqual(v.names(), ['Bravo']);
  assert.equal(prefs.query, 'HIDDEN');
  assert.match(v.q('.sortbar [role=status]').textContent, /1 album matches/);
  typeSearch(v, 'nothing here');
  assert.match(v.pane.textContent, /No albums match/);
});

test('sort select and reverse reuse the Library controls and persist', async () => {
  const v = await open();
  const sort = v.q('.sortbar select');
  assert.deepEqual([...sort.querySelectorAll('option')].map((o) => o.textContent), ['Recently added', 'Title', 'Artist', 'Year', 'Tracks', 'Length', 'BPM']);
  assert.deepEqual(v.names(), ['Bravo', 'Charlie', 'Alpha']);
  sort.value = 'year';
  fire(sort, 'change');
  assert.deepEqual(v.names(), ['Bravo', 'Alpha', 'Charlie']);
  sort.value = 'tracks';
  fire(sort, 'change');
  assert.deepEqual(v.names().slice(0, 2).sort(), ['Alpha', 'Charlie']);
  sort.value = 'bpm';
  fire(sort, 'change');
  assert.equal(v.names()[0], 'Alpha');
  sort.value = 'title';
  fire(sort, 'change');
  assert.deepEqual(v.names(), ['Alpha', 'Bravo', 'Charlie']);
  fire(v.q('.sort-reverse'), 'click');
  assert.deepEqual(v.names(), ['Charlie', 'Bravo', 'Alpha']);
  assert.equal(v.q('.sort-reverse').getAttribute('aria-pressed'), 'true');
  const saved = JSON.parse(localStorage.getItem(model.ALBUMS_KEY));
  assert.equal(saved.sort, 'title');
  assert.equal(saved.reverse, true);
});

test('albums prefs restore from localStorage; damaged or throwing storage is ignored', () => {
  localStorage.setItem(model.ALBUMS_KEY, JSON.stringify({ sort: 'artist', reverse: true, genres: ['House'], years: ['1999'] }));
  model.loadAlbumPrefs();
  assert.equal(model.albumPrefs.sort, 'artist');
  assert.equal(model.albumPrefs.reverse, true);
  assert.deepEqual([...model.albumPrefs.sel.genres], ['House']);
  assert.deepEqual([...model.albumPrefs.sel.years], ['1999']);
  localStorage.setItem(model.ALBUMS_KEY, '{nope');
  assert.doesNotThrow(() => model.loadAlbumPrefs());
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.doesNotThrow(() => { model.loadAlbumPrefs(); model.saveAlbumPrefs(); savePrefs(); loadPrefs(); });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', real);
  }
});

test('Library (songs) prefs persist and restore too', () => {
  prefs.query = 'abc';
  prefs.sort = 'title';
  prefs.reverse = true;
  prefs.sel = new Set(['genre:rock']);
  savePrefs();
  prefs.query = '';
  prefs.sort = 'added';
  prefs.reverse = false;
  prefs.sel = new Set();
  loadPrefs();
  assert.equal(prefs.query, 'abc');
  assert.equal(prefs.sort, 'title');
  assert.equal(prefs.reverse, true);
  assert.deepEqual([...prefs.sel], ['genre:rock']);
  assert.ok(localStorage.getItem(LIBRARY_PREFS_KEY));
  prefs.query = '';
  prefs.sort = 'added';
  prefs.reverse = false;
  prefs.sel = new Set();
});

test('header total, "N albums match", Clear filters, and the shared filter sheet', async () => {
  let total = '';
  window.addEventListener('albums-total', (e) => { total = e.detail.text; });
  const v = await open();
  assert.equal(total, '3 albums');
  fire(v.q('.cat-chip[data-cat=genres]'), 'click');
  for (let i = 0; i < 8; i++) await flush();
  const sheet = document.getElementById('filter-sheet');
  assert.equal(sheet.open, true);
  assert.match(sheet.textContent, /3 in your albums|3 in your albums/);
  fire([...sheet.querySelectorAll('.chip')].find((c) => c.dataset.key === 'House'), 'click');
  assert.deepEqual(v.names().sort(), ['Alpha', 'Charlie']);
  assert.match(sheet.textContent, /2 albums/);
  assert.match(v.q('.sortbar [role=status]').textContent, /2 albums match/);
  sheet.close();
  const clear = [...v.pane.querySelectorAll('button')].find((b) => b.textContent.includes('Clear filters'));
  assert.equal(clear.hidden, false);
  fire(clear, 'click');
  assert.equal(v.names().length, 3);
  assert.equal(v.q('.sortbar [role=status]').textContent, '');
  assert.equal(clear.hidden, true);
});

test('Play all and Add all to queue use the linked songs of the filtered albums in list order', async () => {
  const v = await open();
  const btn = (text) => [...v.pane.querySelectorAll('.sort-actions button')].find((b) => b.textContent.includes(text));
  assert.equal(btn('Play all').textContent, 'Play all 2 linked');
  assert.equal(btn('Add all').hidden, true);
  document.getElementById('toast').textContent = '';
  fire(btn('Play all'), 'click');
  assert.match(document.getElementById('toast').textContent, /Playing 2 songs/);
  assert.equal(player.queuePosition('s1').pos < player.queuePosition('s2').pos, true);
  typeSearch(v, 'alpha');
  assert.equal(btn('Add all').hidden, false);
  assert.equal(btn('Add all').textContent, 'Add all 2 linked to queue');
  fire(btn('Add all'), 'click');
  assert.match(document.getElementById('toast').textContent, /Added|already in queue/);
});

test('whole-row click opens the info box; the queue button and cover do not', async () => {
  const v = await open();
  const dlg = document.getElementById('song-card');
  fire(v.q('li.album-row .info'), 'click');
  assert.equal(dlg.open, true);
  assert.equal(dlg.querySelector('h2').textContent, 'Bravo');
  dlg.close();
  fire(v.q('li.album-row .row-acts button'), 'click');
  assert.equal(dlg.open, false);
});

test('the row is marked current while one of its songs plays', async () => {
  const v = await open();
  const alpha = v.q('li.album-row[data-id=Alpha]');
  store.songs = [...store.songs, { id: 's9', title: 'Other', artist: 'Q', file: 's9.mp3', duration: 10 }];
  player.playNow('s9');
  for (let i = 0; i < 3; i++) await flush();
  assert.equal(alpha.classList.contains('current'), false);
  player.playNow('s2');
  for (let i = 0; i < 3; i++) await flush();
  assert.equal(alpha.classList.contains('current'), true);
  assert.equal(alpha.getAttribute('aria-current'), 'true');
  assert.equal(v.q('li.album-row[data-id=Bravo]').classList.contains('current'), false);
});

test('empty state has an Add album button', async () => {
  const v = await open([]);
  assert.match(v.pane.textContent, /No albums yet/);
  assert.ok([...v.pane.querySelectorAll('button')].some((b) => b.textContent.includes('Add album')));
});

test('model: matchesQuery folds accents; length and bpm sorts put albums without data last', () => {
  assert.equal(model.matchesQuery({ title: 'Café del Mar', artist: '', tracks: [] }, 'cafe'), true);
  reset();
  model.albumPrefs.sort = 'bpm';
  assert.deepEqual(model.sortedAlbums(ALL).map((a) => a.id)[0], 'Alpha');
  model.albumPrefs.sort = 'length';
  assert.deepEqual(model.sortedAlbums(ALL).map((a) => a.id), ['Charlie', 'Alpha', 'Bravo']);
});

test('Edit dialog: fields, only changed keys sent, genres from the vocabulary field, deletes at the bottom', async () => {
  const dlg = document.getElementById('edit-dialog');
  const calls = stubFetch((u, o) => (o.method === 'PATCH' ? ok({ ...A, title: 'Alpha 2', year: 2001 }) : ok({})));
  let saved = null;
  openAlbumEdit(A, (full) => { saved = full; });
  const labels = [...dlg.querySelectorAll('.field > label')].map((l) => l.textContent);
  assert.deepEqual(labels.slice(0, 3), ['Title', 'Artist', 'Year']);
  assert.ok(dlg.querySelector('.chip-field'));
  assert.deepEqual([...dlg.querySelectorAll('.row.end > button')].map((b) => b.textContent), ['Delete album', 'Save']);
  assert.deepEqual([...dlg.querySelectorAll('.album-edit-links label')].map((l) => l.textContent), ['Discogs', 'Rate Your Music', 'YouTube', 'Wikipedia']);
  const inputs = [...dlg.querySelectorAll('.field > input')];
  inputs[0].value = ' Alpha 2 ';
  inputs[2].value = '2001';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const patch = calls.find((c) => c.opts.method === 'PATCH');
  assert.equal(patch.url, '/albums/Alpha');
  assert.deepEqual(JSON.parse(patch.opts.body), { title: 'Alpha 2', year: 2001 });
  assert.equal(saved.title, 'Alpha 2');
  assert.equal(dlg.open, false);
});

test('Edit dialog: nothing changed makes no request; invalid year and 422 bad_field show per-field errors', async () => {
  const dlg = document.getElementById('edit-dialog');
  let calls = stubFetch(() => ok({}));
  openAlbumEdit(A, () => {});
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 3; i++) await flush();
  assert.equal(calls.some((c) => c.opts.method === 'PATCH'), false);
  assert.equal(dlg.open, false);

  openAlbumEdit(A, () => {});
  dlg.querySelectorAll('.field > input')[2].value = 'abcd';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 3; i++) await flush();
  const yearErr = dlg.querySelectorAll('.field')[2].querySelector('.msg.error');
  assert.equal(yearErr.hidden, false);
  assert.match(yearErr.textContent, /whole number/);
  dlg.close();

  calls = stubFetch((u, o) => (o.method === 'PATCH' ? { status: 422, body: { error: 'bad_field', key: 'artist' } } : ok({})));
  openAlbumEdit(A, () => {});
  dlg.querySelectorAll('.field > input')[1].value = 'x'.repeat(5);
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const artistErr = dlg.querySelectorAll('.field')[1].querySelector('.msg.error');
  assert.equal(artistErr.hidden, false);
  assert.match(artistErr.textContent, /artist is not valid/);
  assert.equal(dlg.open, true);
  dlg.close();
});

test('rows follow the Songs table: header row, title with muted count, duration at the right, genres as text, BPM badge', async () => {
  const v = await open();
  const head = v.q('.group .table-head');
  assert.deepEqual([...head.querySelectorAll('span')].map((x) => x.textContent), ['', 'Album', 'Genres']);
  const row = v.q('li.album-row[data-id=Alpha]');
  assert.ok(row.querySelector('.title-line .open.mq'), 'the title uses the shared marquee');
  assert.ok(row.querySelector('.title-line .open').classList.contains('t-headline'));
  assert.equal(row.querySelector('.title-line .open .rmx').textContent, '· 2 tracks');
  assert.ok(row.querySelector('.title-line > .title-len'));
  assert.equal(row.querySelector('.c-genres .g-txt').textContent, 'House');
  assert.equal(row.querySelector('.sub-end .bpm-badge').textContent, '120 - 126BPM');
  assert.equal(row.querySelector('.row-cover .rc-ov') !== null, true);
});

test('cover of the playing album toggles play and pause; other covers start the album', async () => {
  const v = await open();
  const alpha = v.q('li.album-row[data-id=Alpha]');
  player.playNow('s1');
  for (let i = 0; i < 3; i++) await flush();
  assert.ok(alpha.querySelector('.row-cover').classList.contains('persist'));
  assert.match(alpha.querySelector('.row-cover').getAttribute('aria-label'), /^(Pause|Play) album Alpha/);
  assert.equal(v.q('li.album-row[data-id=Bravo] .row-cover').classList.contains('persist'), false);
});

test('Show playing: shown while an album song plays; hidden by filters offers a Show action', async () => {
  const v = await open();
  const btn = [...v.pane.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Show playing'));
  player.playNow('s1');
  for (let i = 0; i < 3; i++) await flush();
  assert.equal(btn.hidden, false);
  const origScroll = globalThis.window?.scrollTo;
  window.scrollTo = () => {};
  fire(btn, 'click');
  assert.ok(v.q('li.album-row[data-id=Alpha]').classList.contains('flash'));
  typeSearch(v, 'bravo');
  document.getElementById('toast').textContent = '';
  fire(btn, 'click');
  assert.match(document.getElementById('toast').textContent, /Album is hidden by the current filters/);
  fire(document.querySelector('#toast .toast-act'), 'click');
  assert.equal(v.names().length, 3);
  window.scrollTo = origScroll;
});

test('match summary lists the selected genres and years after the count', async () => {
  const v = await open();
  model.albumPrefs.sel.genres.add('House');
  typeSearch(v, 'a');
  assert.match(v.q('.sortbar [role=status]').textContent, /albums? match(es)? · House/);
});

test('Edit dialog: links are four fields; one Save sends only the changed keys with the fields; bad_link shows under the field and keeps typed text', async () => {
  const dlg = document.getElementById('edit-dialog');
  const album = { ...A, links: { discogs: 'https://www.discogs.com/release/1' } };
  let calls = stubFetch((u, o) => (o.method === 'PATCH' ? ok({ ...album, links: { discogs: 'https://www.discogs.com/release/1', youtube: 'https://www.youtube.com/playlist?list=PL1' } }) : ok({})));
  let saved = null;
  openAlbumEdit(album, (full) => { saved = full; });
  const key = (k) => dlg.querySelector(`input[data-key="${k}"]`);
  assert.equal(key('discogs').value, 'https://www.discogs.com/release/1');
  key('youtube').value = ' https://www.youtube.com/playlist?list=PL1 ';
  dlg.querySelector('input[aria-label=Title]').value = 'Alpha 3';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const patch = calls.find((c) => c.opts.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.opts.body), { title: 'Alpha 3', links: { youtube: 'https://www.youtube.com/playlist?list=PL1' } });
  assert.equal(saved.links.youtube, 'https://www.youtube.com/playlist?list=PL1');

  openAlbumEdit(album, () => {});
  key('discogs').value = '';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(JSON.parse(calls.filter((c) => c.opts.method === 'PATCH')[1].opts.body), { links: { discogs: null } });

  calls = stubFetch((u, o) => (o.method === 'PATCH' ? { status: 422, body: { error: 'bad_link', key: 'wikipedia' } } : ok({})));
  openAlbumEdit(album, () => {});
  key('wikipedia').value = 'junk';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const err = key('wikipedia').parentNode.querySelector('.msg.error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'This is not a valid Wikipedia address.');
  assert.equal(key('wikipedia').value, 'junk');
  assert.equal(dlg.open, true);
  assert.equal(dlg.querySelector('form button[type=submit]').disabled, false);
  dlg.close();
});

test('the list payload carries the tracks: no per-album request; a list without tracks falls back to the single fetch', async () => {
  reset();
  const pane = document.createElement('div');
  document.body.append(pane);
  let calls = stubFetch((u) => (u === '/albums' ? ok(ALL.map((a) => ({ ...a, trackCount: a.tracks.length }))) : ok({})));
  let unmount = mountAlbums(pane, '');
  await unmount.ready;
  assert.deepEqual(calls.map((c) => c.url), ['/albums']);
  assert.equal(pane.querySelectorAll('li.album-row').length, 3);
  assert.equal(pane.querySelector('li.album-row[data-id=Alpha] .bpm-badge').textContent, '120 - 126BPM');
  unmount();
  const pane2 = document.createElement('div');
  document.body.append(pane2);
  calls = stubFetch((u) => (u === '/albums' ? ok(ALL.map(({ tracks, ...r }) => ({ ...r, trackCount: tracks.length }))) : ok(ALL.find((a) => u === `/albums/${a.id}`) || {})));
  unmount = mountAlbums(pane2, '');
  await unmount.ready;
  assert.equal(calls.filter((c) => c.url !== '/albums').length, 3);
  unmount();
});
