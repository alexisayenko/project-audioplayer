import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { player } = await import('./player.js');
const { resetVocabulary, buildIndex } = await import('./genre-vocab.js');
resetVocabulary(buildIndex({ genres: ['Techno', 'Ambient', 'Dub', 'House'].map((name) => ({ name, family: 'Electronic', level: 'genre' })), aliases: {} }));
const { mountAlbums, openAddAlbum, albumIdOf, totalTime, bpmRange, GENRE_MAX, albumLinks, facetValues, matchesFacets, fetchErrorText } = await import('./albums.js');

const PREVIEW = { title: 'Tumult', artist: 'Derango', year: 2004, source: 'discogs:545650', tracks: [{ no: 1, title: 'Intro', durationS: 65 }, { no: 2, title: 'Noise', durationS: null }] };
const ALBUM = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, source: 'discogs:545650', tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: null }, { no: 2, title: 'Noise', durationS: 200, songId: null }] };
const ROW = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 2, created_at: '2026-10-26T10:00:00Z' };

function setup(handler, id = '') {
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch(handler);
  const unmount = mountAlbums(pane, id);
  return { pane, calls, unmount, q: (s) => pane.querySelector(s), text: () => pane.textContent };
}
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const dq = (s) => D().querySelector(s);
const dqa = (s) => D().querySelectorAll(s);
async function submitUrl(v, value) {
  if (!D().open) openAddAlbum();
  dq('.well input').value = value;
  fire(dq('.well'), 'submit');
  await flush();
  await flush();
}

test('headline and route helpers', () => {
  assert.equal(totalTime(PREVIEW.tracks), '1:05');
  assert.equal(totalTime([{ durationS: null }]), '');
  assert.equal(bpmRange(PREVIEW.tracks), '');
  assert.equal(albumIdOf('#/library/albums/alb_1'), 'alb_1');
  assert.equal(albumIdOf('#/library/albums'), '');
});

test('empty state and the one-row form', async () => {
  const v = setup((u) => (u === '/albums' ? ok([]) : ok({})));
  await v.unmount.ready;
  assert.match(v.text(), /No albums yet/);
  assert.equal(v.q('.albums-row'), null);
  assert.equal(v.q('.toolbar').hidden, true);
  const add = [...v.pane.querySelectorAll('button')].find((b) => b.textContent.includes('Add album'));
  assert.ok(add);
  assert.equal(v.pane.querySelectorAll('dialog').length, 0);
});

test('list renders song-style rows: name and count over artist and year, total time, no track list', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : u === '/albums/alb_1' ? ok(ALBUM) : ok({})));
  await v.unmount.ready;
  const card = v.q('.album-row');
  assert.match(card.textContent, /Tumult · 2 tracks[\s\S]*Derango · 2004/);
  assert.ok(card.classList.contains('song'));
  assert.equal(v.q('ul.songs.album-list').parentNode.className.includes('group'), true);
  assert.equal(v.q('.title-len').textContent, '4:25');
  assert.equal(v.q('.title-len').className.includes('t-time'), true);
  assert.equal(v.q('.row-cover .cover-mark') !== null, true);
  assert.equal(card.querySelector('a'), null);
  assert.equal(v.pane.textContent.includes('Album page'), false);
  assert.equal(card.querySelector('.album-tracks'), null);
});

test('Add Album popup: Fetch shows the preview in the same popup, Create posts it, closes it and the row joins the list', async () => {
  let created = false;
  const v = setup((u, o) => {
    if (u === '/albums/preview') return ok(PREVIEW);
    if (u === '/albums' && o.method === 'POST') { created = true; return ok(ALBUM, 201); }
    if (u === '/albums') return ok(created ? [ROW] : []);
    if (u === '/albums/alb_1') return ok(ALBUM);
    return ok({});
  });
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/545650-Derango-Tumult');
  const pv = v.calls.find((c) => c.url === '/albums/preview');
  assert.deepEqual(JSON.parse(pv.opts.body), { url: 'https://www.discogs.com/release/545650-Derango-Tumult' });
  assert.match(dq('.album-preview').textContent, /Derango - Tumult · 2004/);
  assert.match(dq('.album-preview').textContent, /1:05/);
  const create = [...dqa('button')].find((b) => b.textContent === 'Create');
  assert.ok([...dqa('button')].some((b) => b.textContent === 'Back'));
  fire(create, 'click');
  await flush(); await flush(); await flush();
  assert.deepEqual(JSON.parse(v.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST').opts.body), { ...PREVIEW, genres: [] });
  assert.equal(dq('.album-preview'), null);
  assert.equal(D().open, false);
  assert.equal(v.pane.querySelectorAll('.album-row').length, 1);
});

test('Back returns from the preview to the URL step', async () => {
  const v = setup((u) => (u === '/albums/preview' ? ok(PREVIEW) : ok([])));
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/1');
  fire([...dqa('button')].find((b) => b.textContent === 'Back'), 'click');
  assert.equal(dq('.album-preview'), null);
});

for (const [status, code, re] of [[400, 'bad_url', /not a Discogs release link/], [404, 'not_found', /no release/], [503, 'discogs_unavailable', /not available/]]) {
  test(`preview error ${status} shows inline`, async () => {
    const v = setup((u) => (u === '/albums/preview' ? { status, body: { error: code, detail: code } } : ok([])));
    await v.unmount.ready;
    await submitUrl(v, 'https://www.discogs.com/release/1');
    assert.match(dq('.msg.error').textContent, re);
    assert.equal(dq('.msg.error').hidden, false);
    assert.equal(dq('.album-preview'), null);
  });
}

test('empty address asks for one without a request', async () => {
  const v = setup(() => ok([]));
  await v.unmount.ready;
  await submitUrl(v, '  ');
  assert.match(dq('.msg.error').textContent, /Paste a Discogs/);
  assert.equal(v.calls.some((c) => c.url === '/albums/preview'), false);
});

test('409 on create says it exists and links to it', async () => {
  const v = setup((u, o) => {
    if (u === '/albums/preview') return ok(PREVIEW);
    if (u === '/albums' && o.method === 'POST') return { status: 409, body: { error: 'already_exists', id: 'alb_9' } };
    return ok([]);
  });
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/1');
  fire([...dqa('button')].find((b) => b.textContent === 'Create'), 'click');
  await flush(); await flush();
  const e = dq('.msg.error');
  assert.match(e.textContent, /already exists/);
  assert.equal(e.querySelector('a'), null);
  assert.match(e.querySelector('button').textContent, /Open it/);
});

test('list load failure shows Retry', async () => {
  const v = setup(() => ({ status: 500, body: { detail: 'down' } }));
  await v.unmount.ready;
  assert.match(v.text(), /could not be loaded/);
});

test('album page lists tracks and Delete album confirms then deletes', async () => {
  const v = setup((u, o) => (o.method === 'DELETE' ? { status: 204, body: null } : ok(ALBUM)), 'alb_1');
  await v.unmount.ready;
  assert.match(v.q('h2').textContent, /Tumult · 2 tracks/);
  assert.match(v.q('.album-sub').textContent, /Derango · 2004/);
  assert.equal(v.pane.querySelectorAll('.album-track').length, 2);
  fire([...v.pane.querySelectorAll('button')].find((b) => b.textContent === 'Delete album'), 'click');
  const dlg = document.getElementById('pl-dialog');
  assert.equal(dlg.open, true);
  assert.match(dlg.textContent, /Delete album\?/);
  assert.equal(v.calls.some((c) => c.opts.method === 'DELETE'), false);
  fire(dlg.querySelector('form'), 'submit');
  await flush(); await flush();
  assert.ok(v.calls.some((c) => c.url === '/albums/alb_1' && c.opts.method === 'DELETE'));
  assert.equal(location.hash, '#/library/albums');
});

test('album page 404', async () => {
  const v = setup(() => ({ status: 404, body: { detail: 'nope' } }), 'alb_x');
  await v.unmount.ready;
  assert.match(v.text(), /does not exist/);
});

test('fetchErrorText falls back to the message', () => {
  assert.equal(fetchErrorText({ status: 500, message: 'boom' }), 'boom');
});

test('card header: album and track count, artist and year, total time, bpm of linked songs only, genre chips', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 's1', bpm: 120 }, { id: 's2', bpm: 128.4 }];
  const full = { ...ALBUM, genres: ['Techno', 'Ambient'], tracks: [{ no: 1, title: 'A', durationS: 60, songId: 's1' }, { no: 2, title: 'B', durationS: 3600, songId: 's2' }, { no: 3, title: 'C', durationS: 5, songId: null }] };
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(full)));
  await v.unmount.ready;
  assert.match(v.q('.title-line .open').textContent, /^Tumult · 3 tracks/);
  assert.equal(v.q('.title-line .open .ttl').textContent, 'Tumult');
  assert.equal(v.q('.title-line .open .rmx').textContent, '· 3 tracks');
  assert.equal(v.q('.album-sub').textContent, 'Derango · 2004');
  assert.equal(v.q('.album-time').textContent, '1:01:05');
  assert.equal(v.q('.sub-line .sub-end .bpm-badge').textContent, '120 - 128BPM');
  assert.equal(v.q('.c-genres .g-txt').textContent, 'Techno, Ambient');
  assert.equal(v.q('.album-facts'), null);
  store.songs = [];
  assert.equal(bpmRange(full.tracks), '');
});

test('header omits bpm and chips when nothing is linked or genres are missing', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await v.unmount.ready;
  assert.equal(v.q('.album-bpm'), null);
  assert.equal(v.pane.querySelectorAll('.album-row .chip').length, 0);
  assert.equal(v.q('.c-genres .g-txt').textContent, '');
});

test('facet helpers: distinct values with counts, any within a facet, all across facets', () => {
  const albums = [{ genres: ['Techno'], year: 2004 }, { genres: ['Techno', 'House'], year: 1999 }, { genres: [], year: 2004 }];
  const g = { id: 'genres', of: (a) => a.genres };
  assert.deepEqual(facetValues(albums, g), [{ value: 'House', count: 1 }, { value: 'Techno', count: 2 }]);
  const sel = { genres: new Set(['House', 'Techno']), years: new Set(['2004']) };
  assert.deepEqual(albums.map((a) => matchesFacets(a, sel)), [true, false, false]);
});

test('facet pills: hidden without albums; Genres and Years counts; picking filters the cards', async () => {
  const none = setup(() => ok([]));
  await none.unmount.ready;
  assert.equal(none.q('.toolbar').hidden, true);

  const rows = [{ ...ROW, id: 'a1', genres: ['Techno'], year: 2004 }, { ...ROW, id: 'a2', title: 'Other', genres: ['House'], year: 1999 }];
  const v = setup((u) => (u === '/albums' ? ok(rows) : ok(rows.find((r) => u.endsWith(r.id)))));
  await v.unmount.ready;
  const bar = v.q('.albums-facets');
  assert.equal(bar.hidden, false);
  const pills = [...bar.querySelectorAll('.cat-chip')];
  assert.deepEqual(pills.map((p) => p.textContent), ['Genres2', 'Years2']);
  assert.equal(v.pane.querySelectorAll('.album-row').length, 2);
  fire(pills[0], 'click');
  for (let i = 0; i < 8; i++) await flush();
  const dlg = document.getElementById('filter-sheet');
  assert.equal(dlg.open, true);
  fire([...dlg.querySelectorAll('.chip')].find((c) => c.dataset.key === 'House'), 'click');
  assert.equal(v.pane.querySelectorAll('.album-row').length, 1);
  assert.match(v.q('.album-row').textContent, /Other/);
  assert.equal(v.q('.albums-facets .cat-chip').getAttribute('aria-label'), 'Genres, 1 selected');
  fire([...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Clear'), 'click');
  assert.equal(v.pane.querySelectorAll('.album-row').length, 2);
});

test('album row queue button: omitted with no playable song, queues linked songs in track order, toggles', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'q1', title: 'One', artist: 'X', file: 'q1.mp3', duration: 60 }, { id: 'q2', title: 'Two', artist: 'X', file: 'q2.mp3', duration: 60 }];
  const none = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await none.unmount.ready;
  assert.equal(none.q('.album-queue'), null);
  assert.equal(none.q('.row-acts').children.length, 0);

  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'B', durationS: 1, songId: 'q2' }, { no: 2, title: 'gap', durationS: 1, songId: null }, { no: 3, title: 'A', durationS: 1, songId: 'q1' }] };
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(linked)));
  await v.unmount.ready;
  const btn = v.q('.album-queue');
  assert.ok(btn.classList.contains('act-queue') && btn.classList.contains('sq-btn'));
  assert.equal(btn.title, 'Add to queue');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(v.q('.album-row').firstChild, v.q('.row-acts'));
  assert.ok(v.q('.album-row .row-acts').contains(btn));
  fire(btn, 'click');
  assert.ok(player.queuePosition('q2').pos < player.queuePosition('q1').pos);
  assert.match(document.getElementById('toast').textContent, /Added 2 songs/);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.ok(btn.classList.contains('on'));
  fire(btn, 'click');
  assert.equal(player.inQueue('q1') || player.inQueue('q2'), false);
  assert.match(document.getElementById('toast').textContent, /Removed 2 songs from queue/);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('tapping the album name opens the info box; Esc/close and backdrop close it', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'i1', bpm: 100 }, { id: 'i2', bpm: 140 }];
  const full = { ...ALBUM, genres: ['Techno'], source: { url: 'https://www.discogs.com/release/545650-Derango-Tumult' }, tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: 'i1' }, { no: 2, title: 'Noise', durationS: 200, songId: 'i2' }] };
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(full)));
  await v.unmount.ready;
  fire(v.q('.album-name-btn'), 'click');
  const dlg = document.getElementById('song-card');
  assert.equal(dlg.open, true);
  assert.equal(dlg.querySelector('h2').textContent, 'Tumult');
  assert.equal(dlg.querySelector('.card-sub').textContent, 'Derango · 2004');
  assert.equal(dlg.querySelector('.card-details').textContent, '100 - 140BPMTracks: 2Length: 4:25');
  assert.equal(dlg.querySelector('.card-art'), null);
  assert.deepEqual([...dlg.querySelectorAll('.card-genre-line .tag')].map((c) => c.textContent), ['Techno']);
  assert.equal(dlg.querySelector('.svc-discogs').getAttribute('href'), 'https://www.discogs.com/release/545650-Derango-Tumult');
  assert.equal(dlg.querySelector('.svc-youtube'), null);
  assert.deepEqual([...dlg.querySelectorAll('.album-info-tracks li')].map((li) => li.textContent), ['1.Intro1:05-', '2.Noise3:20-']);
  assert.ok(dlg.querySelector('.card-close'));
  fire(dlg.querySelector('.card-close'), 'click');
  assert.equal(dlg.open, false);
});

test('info box on the album page title; no links or genres row when there is no data; discogs:ID source', async () => {
  const bare = { ...ALBUM, genres: undefined, source: 'discogs:545650', tracks: [] };
  const v = setup(() => ok(bare), 'alb_1');
  await v.unmount.ready;
  fire(v.q('h2 .album-name-btn'), 'click');
  const dlg = document.getElementById('song-card');
  assert.equal(dlg.querySelector('.card-genre-line'), null);
  assert.equal(dlg.querySelector('.svc-discogs').getAttribute('href'), 'https://www.discogs.com/release/545650');
  assert.doesNotMatch(dlg.querySelector('.card-details')?.textContent || '', /BPM/);
  dlg.close();
  assert.deepEqual(albumLinks({ source: 'https://evil.example/x' }), {});
});

test('info box action row: Play album, Play next, queue toggle, playlist, edit; no disabled buttons; no unimplemented ones', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'z1', title: 'One', artist: 'X', file: 'z1.mp3', duration: 60 }];
  const dlg = document.getElementById('song-card');
  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'A', durationS: 1, songId: 'z1' }] };
  const none = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await none.unmount.ready;
  fire(none.q('.album-name-btn'), 'click');
  const names0 = [...dlg.querySelectorAll('.card-icons button')].map((b) => b.getAttribute('aria-label').split(':')[0]);
  assert.deepEqual(names0, ['Edit']);
  dlg.close();

  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(linked)));
  await v.unmount.ready;
  fire(v.q('.album-name-btn'), 'click');
  const acts = [...dlg.querySelectorAll('.card-icons button')];
  const names = acts.map((b) => b.getAttribute('aria-label').split(':')[0]);
  assert.deepEqual(names.slice(0, 3), ['Play album', 'Play next', 'Add to queue']);
  assert.ok(names.includes('Edit'));
  assert.equal(names.includes('Share link') || names.includes('Download'), false);
  assert.ok(acts.every((b) => !b.disabled));
  document.getElementById('toast').textContent = '';
  const queue = acts[2];
  assert.ok(queue.classList.contains('pl-toggle'));
  fire(queue, 'click');
  assert.match(document.getElementById('toast').textContent, /Added 1 song/);
  assert.equal(queue.getAttribute('aria-pressed'), 'true');
  fire(queue, 'click');
  assert.equal(queue.getAttribute('aria-pressed'), 'false');
  fire(acts[0], 'click');
  assert.match(document.getElementById('toast').textContent, /Playing 1 song/);
  dlg.close();
});

test('preview genres use the song-form genre field: vocabulary suggestions, remove, cap, free text refused, Create sends them', async () => {
  const withGenres = { ...PREVIEW, genres: ['Techno', 'Dub'] };
  const v = setup((u, o) => {
    if (u === '/albums/preview') return ok(withGenres);
    if (u === '/albums' && o.method === 'POST') return ok({ ...ALBUM }, 201);
    return ok([]);
  });
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/1');
  const chips = () => [...dqa('.album-preview .chips .chip.tint')].map((c) => c.textContent);
  assert.deepEqual(chips(), ['Techno', 'Dub']);
  fire([...dqa('.album-preview .x')].find((b) => b.getAttribute('aria-label') === 'Remove Dub'), 'click');
  assert.deepEqual(chips(), ['Techno']);
  const input = dq('.album-preview .chip-field input');
  assert.equal(input.getAttribute('role'), 'combobox');
  input.value = 'amb';
  fire(input, 'input');
  const opts = [...dqa('.album-preview [role=option]')];
  assert.deepEqual(opts.map((o) => o.dataset.genre), ['Ambient']);
  fire(opts[0], 'click');
  assert.deepEqual(chips(), ['Techno', 'Ambient']);
  input.value = 'Nonsense';
  fire(input, 'keydown', { key: 'Enter' });
  assert.deepEqual(chips(), ['Techno', 'Ambient']);
  assert.match(dq('.album-preview .genre-hint').textContent, /not in the genre list/);
  input.value = '';
  fire([...dqa('button')].find((b) => b.textContent === 'Create'), 'click');
  await flush(); await flush();
  const post = v.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST');
  assert.deepEqual(JSON.parse(post.opts.body).genres, ['Techno', 'Ambient']);
  assert.equal(GENRE_MAX, 20);
});

test('rows show genres as plain muted text like Songs, no chips', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok({ ...ALBUM, genres: ['Techno'] })));
  await v.unmount.ready;
  assert.equal(v.pane.querySelectorAll('.album-row .chip').length, 0);
  assert.equal(v.q('.album-row .c-genres .g-txt').textContent, 'Techno');
});

test('the list row keeps ONLY the queue button; the cover plays the linked songs', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'r1', title: 'One', artist: 'X', file: 'r1.mp3', duration: 60 }, { id: 'r2', title: 'Two', artist: 'X', file: 'r2.mp3', duration: 60 }];
  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'B', durationS: 1, songId: 'r2' }, { no: 2, title: 'A', durationS: 1, songId: 'r1' }] };
  const none = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await none.unmount.ready;
  const cover0 = none.q('.album-row .row-cover');
  assert.equal(cover0.disabled, true);
  assert.ok(none.q('.album-row').classList.contains('unlinked'));

  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(linked)));
  await v.unmount.ready;
  const row = v.q('.album-row');
  assert.equal(row.querySelectorAll('.row-acts button').length, 1);
  assert.equal(row.querySelectorAll('.album-act').length, 1);
  assert.ok(row.querySelector('.row-acts .act-queue'));
  const cover = row.querySelector('.row-cover');
  assert.equal(cover.disabled, false);
  document.getElementById('toast').textContent = '';
  fire(cover, 'click');
  assert.match(document.getElementById('toast').textContent, /Playing 2 songs/);
  assert.equal(player.queuePosition('r2').pos < player.queuePosition('r1').pos, true);
});

test('Delete album and its tracks: hidden without linked songs; confirm text; cancel makes no calls', async () => {
  const none = setup(() => ok(ALBUM), 'alb_1');
  await none.unmount.ready;
  assert.equal(none.q('.album-delete-all'), null);
  assert.ok([...none.pane.querySelectorAll('button')].some((b) => b.textContent === 'Delete album'));

  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'A', durationS: 1, songId: 's1' }, { no: 2, title: 'B', durationS: 1, songId: null }, { no: 3, title: 'C', durationS: 1, songId: 's3' }] };
  const v = setup(() => ok(linked), 'alb_1');
  await v.unmount.ready;
  fire(v.q('.album-delete-all'), 'click');
  const dlg = document.getElementById('pl-dialog');
  assert.equal(dlg.open, true);
  assert.match(dlg.textContent, /Delete album 'Tumult' and 2 songs from your library\? This cannot be undone\./);
  const before = v.calls.length;
  dlg.close();
  assert.equal(v.calls.length, before);
  assert.equal(v.calls.some((c) => c.opts.method === 'DELETE'), false);
});

test('Delete album and its tracks: deletes songs one by one, then the album, then reports', async () => {
  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'A', durationS: 1, songId: 's1' }, { no: 2, title: 'C', durationS: 1, songId: 's3' }] };
  const v = setup((u, o) => (o.method === 'DELETE' ? { status: 204, body: null } : u === '/library' ? ok({ songs: [] }) : ok(linked)), 'alb_1');
  await v.unmount.ready;
  fire(v.q('.album-delete-all'), 'click');
  const dlg = document.getElementById('pl-dialog');
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 8; i++) await flush();
  const dels = v.calls.filter((c) => c.opts.method === 'DELETE').map((c) => c.url);
  assert.deepEqual(dels, ['/songs/s1', '/songs/s3', '/albums/alb_1']);
  assert.match(document.getElementById('toast').textContent, /Deleted "Tumult" and 2 songs/);
  assert.equal(dlg.open, false);
  assert.equal(location.hash, '#/library/albums');
});

test('Delete album and its tracks: first error stops, shows Deleted M of N and keeps the album', async () => {
  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'A', durationS: 1, songId: 's1' }, { no: 2, title: 'B', durationS: 1, songId: 's2' }, { no: 3, title: 'C', durationS: 1, songId: 's3' }] };
  const v = setup((u, o) => {
    if (u === '/songs/s2' && o.method === 'DELETE') return { status: 500, body: { detail: 'disk error' } };
    if (o.method === 'DELETE') return { status: 204, body: null };
    return u === '/library' ? ok({ songs: [] }) : ok(linked);
  }, 'alb_1');
  await v.unmount.ready;
  fire(v.q('.album-delete-all'), 'click');
  const dlg = document.getElementById('pl-dialog');
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 8; i++) await flush();
  const dels = v.calls.filter((c) => c.opts.method === 'DELETE').map((c) => c.url);
  assert.deepEqual(dels, ['/songs/s1', '/songs/s2']);
  assert.match(dlg.querySelector('.msg.error').textContent, /Deleted 1 of 3 songs: disk error/);
  assert.equal(dlg.open, true);
  dlg.close();
});

test('the info box has no delete buttons; the pencil opens the Edit dialog whose Delete album step offers both', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'x1', file: 'x1.mp3' }];
  const full = { ...ALBUM, genres: ['Techno'], tracks: [{ no: 1, title: 'A', durationS: 1, songId: 'x1' }] };
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(full)));
  await v.unmount.ready;
  fire(v.q('.album-name-btn'), 'click');
  const dlg = document.getElementById('song-card');
  assert.equal(dlg.querySelector('.album-delete'), null);
  assert.equal(dlg.querySelector('.album-delete-all'), null);
  fire(dlg.querySelector('.act-edit'), 'click');
  const edit = document.getElementById('edit-dialog');
  assert.equal(edit.open, true);
  const footer = [...edit.querySelectorAll('.row.end > button')];
  assert.deepEqual(footer.map((x) => x.textContent), ['Delete album', 'Save']);
  assert.ok(footer[0].classList.contains('danger') && footer[0].classList.contains('del-left'));
  assert.equal(edit.querySelector('.album-delete-choice'), null);
  fire(footer[0], 'click');
  assert.match(edit.querySelector('h2').textContent, /Delete album?/);
  const choice = [...edit.querySelectorAll('.album-delete-choice button')];
  assert.deepEqual(choice.map((x) => x.textContent), ['Delete album', 'Delete album and its songs']);
  edit.close();
  dlg.close();
});
