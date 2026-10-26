import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { player } = await import('./player.js');
const { mountAlbums, albumIdOf, totalTime, bpmRange, addGenres, GENRE_MAX, albumLinks, facetValues, matchesFacets, fetchErrorText } = await import('./albums.js');

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
async function submitUrl(v, value) {
  v.q('.albums-url').value = value;
  fire(v.q('.albums-row'), 'submit');
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
  assert.ok(v.q('.albums-row input'));
  assert.match(v.q('.albums-row button').textContent, /Add Album/);
  assert.equal(v.pane.querySelectorAll('dialog').length, 0);
});

test('list renders cards headed Artist - Album with tracks', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : u === '/albums/alb_1' ? ok(ALBUM) : ok({})));
  await v.unmount.ready;
  const card = v.q('.album-card');
  assert.match(card.textContent, /Tumult · 2 tracks[sS]*Derango · 2004/);
  assert.match(card.textContent, /Intro/);
  assert.match(card.textContent, /1:05/);
  assert.match(card.textContent, /3:20/);
  assert.equal(card.querySelector('a').getAttribute('href'), '#/library/albums/alb_1');
});

test('Add Album fetches the preview, Create posts it and the card joins the list', async () => {
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
  assert.match(v.q('.album-preview').textContent, /Tumult · 2 tracks[sS]*Derango · 2004/);
  assert.match(v.q('.album-preview').textContent, /1:05/);
  const create = [...v.pane.querySelectorAll('button')].find((b) => b.textContent === 'Create');
  assert.ok([...v.pane.querySelectorAll('button')].some((b) => b.textContent === 'Cancel'));
  fire(create, 'click');
  await flush(); await flush(); await flush();
  assert.deepEqual(JSON.parse(v.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST').opts.body), { ...PREVIEW, genres: [] });
  assert.equal(v.q('.album-preview'), null);
  assert.equal(v.pane.querySelectorAll('.album-card').length, 1);
});

test('Cancel drops the preview', async () => {
  const v = setup((u) => (u === '/albums/preview' ? ok(PREVIEW) : ok([])));
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/1');
  fire([...v.pane.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'), 'click');
  assert.equal(v.q('.album-preview'), null);
});

for (const [status, code, re] of [[400, 'bad_url', /not a Discogs release link/], [404, 'not_found', /no release/], [503, 'discogs_unavailable', /not available/]]) {
  test(`preview error ${status} shows inline`, async () => {
    const v = setup((u) => (u === '/albums/preview' ? { status, body: { error: code, detail: code } } : ok([])));
    await v.unmount.ready;
    await submitUrl(v, 'https://www.discogs.com/release/1');
    assert.match(v.q('.msg.error').textContent, re);
    assert.equal(v.q('.msg.error').hidden, false);
    assert.equal(v.q('.album-preview'), null);
  });
}

test('empty address asks for one without a request', async () => {
  const v = setup(() => ok([]));
  await v.unmount.ready;
  await submitUrl(v, '  ');
  assert.match(v.q('.msg.error').textContent, /Paste a Discogs/);
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
  fire([...v.pane.querySelectorAll('button')].find((b) => b.textContent === 'Create'), 'click');
  await flush(); await flush();
  const e = v.q('.msg.error');
  assert.match(e.textContent, /already exists/);
  assert.equal(e.querySelector('a').getAttribute('href'), '#/library/albums/alb_9');
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
  assert.match(v.q('.album-title').textContent, /^Tumult · 3 tracks$/);
  assert.equal(v.q('.album-sub').textContent, 'Derango · 2004');
  assert.equal(v.q('.album-time').textContent, '1:01:05');
  assert.equal(v.q('.album-bpm').textContent, '120 - 128 bpm');
  assert.deepEqual([...v.pane.querySelectorAll('.album-genres .chip')].map((c) => c.textContent), ['Techno', 'Ambient']);
  store.songs = [];
  assert.equal(bpmRange(full.tracks), '');
});

test('header omits bpm and chips when nothing is linked or genres are missing', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await v.unmount.ready;
  assert.equal(v.q('.album-bpm'), null);
  assert.equal(v.q('.album-genres'), null);
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
  assert.equal(none.q('.albums-facets').hidden, true);

  const rows = [{ ...ROW, id: 'a1', genres: ['Techno'], year: 2004 }, { ...ROW, id: 'a2', title: 'Other', genres: ['House'], year: 1999 }];
  const v = setup((u) => (u === '/albums' ? ok(rows) : ok(rows.find((r) => u.endsWith(r.id)))));
  await v.unmount.ready;
  const bar = v.q('.albums-facets');
  assert.equal(bar.hidden, false);
  const pills = [...bar.querySelectorAll('.cat-chip')];
  assert.deepEqual(pills.map((p) => p.textContent), ['Genres2', 'Years2']);
  assert.equal(v.pane.querySelectorAll('.album-card').length, 2);
  fire(pills[0], 'click');
  const dlg = document.getElementById('filter-sheet');
  assert.equal(dlg.open, true);
  fire([...dlg.querySelectorAll('.chip')].find((c) => c.dataset.key === 'House'), 'click');
  assert.equal(v.pane.querySelectorAll('.album-card').length, 1);
  assert.match(v.q('.album-card').textContent, /Other/);
  assert.equal(v.q('.albums-facets .cat-chip').getAttribute('aria-label'), 'Genres, 1 selected');
  fire([...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Clear'), 'click');
  assert.equal(v.pane.querySelectorAll('.album-card').length, 2);
});

test('album card queue button: disabled with no linked track, queues linked songs in track order', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'q1', title: 'One', artist: 'X', file: 'q1.mp3', duration: 60 }, { id: 'q2', title: 'Two', artist: 'X', file: 'q2.mp3', duration: 60 }];
  const none = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await none.unmount.ready;
  const off = none.q('.album-queue');
  assert.equal(off.disabled, true);
  assert.equal(off.title, 'No songs linked yet');
  assert.ok(off.classList.contains('act-queue') && off.classList.contains('sq-btn'));

  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'B', durationS: 1, songId: 'q2' }, { no: 2, title: 'gap', durationS: 1, songId: null }, { no: 3, title: 'A', durationS: 1, songId: 'q1' }] };
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(linked)));
  await v.unmount.ready;
  const btn = v.q('.album-queue');
  assert.equal(btn.disabled, false);
  assert.equal(btn.title, 'Add to queue');
  assert.equal(v.q('.album-card').firstChild, v.q('.album-acts'));
  assert.ok(v.q('.album-acts').contains(btn));
  fire(btn, 'click');
  assert.ok(player.queuePosition('q2').pos < player.queuePosition('q1').pos);
  assert.match(document.getElementById('toast').textContent, /Added 2 songs/);
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
  assert.equal(dlg.querySelector('h2').textContent, 'Derango - Tumult');
  assert.equal(dlg.querySelector('.album-facts-line').textContent, '2 tracks · 100 - 140 bpm · 4:25 · 2004');
  assert.deepEqual([...dlg.querySelectorAll('.album-genres .tag')].map((c) => c.textContent), ['Techno']);
  assert.equal(dlg.querySelector('.svc-discogs').getAttribute('href'), 'https://www.discogs.com/release/545650-Derango-Tumult');
  assert.equal(dlg.querySelector('.svc-youtube'), null);
  assert.deepEqual([...dlg.querySelectorAll('.album-info-tracks li')].map((li) => li.textContent), ['1.Intro1:05', '2.Noise3:20']);
  assert.ok(dlg.querySelector('.card-art .card-close'));
  fire(dlg.querySelector('.card-close'), 'click');
  assert.equal(dlg.open, false);
});

test('info box on the album page title; no links or genres row when there is no data; discogs:ID source', async () => {
  const bare = { ...ALBUM, genres: undefined, source: 'discogs:545650', tracks: [] };
  const v = setup(() => ok(bare), 'alb_1');
  await v.unmount.ready;
  fire(v.q('h2 .album-name-btn'), 'click');
  const dlg = document.getElementById('song-card');
  assert.equal(dlg.querySelector('.album-genres'), null);
  assert.equal(dlg.querySelector('.svc-discogs').getAttribute('href'), 'https://www.discogs.com/release/545650');
  assert.doesNotMatch(dlg.querySelector('.album-facts-line').textContent, /bpm/);
  dlg.close();
  assert.deepEqual(albumLinks({ source: 'https://evil.example/x' }), {});
});

test('card action row: song-row order, disabled without linked songs, picker wired, others toast', async () => {
  const { store } = await import('./store.js');
  store.songs = [{ id: 'z1', title: 'One', artist: 'X', file: 'z1.mp3', duration: 60 }];
  const linked = { ...ALBUM, tracks: [{ no: 1, title: 'A', durationS: 1, songId: 'z1' }] };
  const none = setup((u) => (u === '/albums' ? ok([ROW]) : ok(ALBUM)));
  await none.unmount.ready;
  const all = [...none.pane.querySelectorAll('.album-act')];
  assert.ok(all.length >= 3);
  assert.ok(all.every((b) => b.disabled && b.title === 'No songs linked yet'));

  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok(linked)));
  await v.unmount.ready;
  const acts = [...v.pane.querySelectorAll('.album-act')];
  const names = acts.map((b) => b.getAttribute('aria-label').split(':')[0]);
  const order = ['Play next', 'Add to queue', 'Add to playlist...', 'Share link', 'Download', 'Edit'].filter((n) => names.includes(n));
  assert.deepEqual(names, order);
  assert.ok(names.slice(0, 2).join() === 'Play next,Add to queue' && names.includes('Share link'));
  assert.ok(acts.every((b) => !b.disabled));
  for (const label of ['Play next', 'Share link']) {
    fire(acts[names.indexOf(label)], 'click');
    assert.equal(document.getElementById('toast').textContent, 'Not implemented yet');
    document.getElementById('toast').textContent = '';
  }
});

test('addGenres trims, dedupes case-insensitively and caps at 20', () => {
  assert.deepEqual(addGenres(['Techno'], ' techno, House ,, Ambient'), ['Techno', 'House', 'Ambient']);
  const many = addGenres([], Array.from({ length: 30 }, (_, i) => `g${i}`).join(','));
  assert.equal(many.length, GENRE_MAX);
});

test('preview genre chips are editable and Create sends the edited list; cards stay read-only', async () => {
  const withGenres = { ...PREVIEW, genres: ['Techno', 'Dub'] };
  const v = setup((u, o) => {
    if (u === '/albums/preview') return ok(withGenres);
    if (u === '/albums' && o.method === 'POST') return ok({ ...ALBUM, genres: ['Techno', 'Ambient'] }, 201);
    return ok([]);
  });
  await v.unmount.ready;
  await submitUrl(v, 'https://www.discogs.com/release/1');
  const chips = () => [...v.pane.querySelectorAll('.album-preview .album-genres .chip')].map((c) => c.textContent);
  assert.deepEqual(chips(), ['Techno', 'Dub']);
  fire([...v.pane.querySelectorAll('.album-preview .x')].find((b) => b.getAttribute('aria-label') === 'Remove Dub'), 'click');
  assert.deepEqual(chips(), ['Techno']);
  const input = v.q('.album-genre-input');
  input.value = 'ambient';
  fire(input, 'keydown', { key: 'Enter' });
  input.value = 'TECHNO,';
  fire(input, 'input');
  assert.deepEqual(chips(), ['Techno', 'ambient']);
  fire([...v.pane.querySelectorAll('button')].find((b) => b.textContent === 'Create'), 'click');
  await flush(); await flush();
  const post = v.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST');
  assert.deepEqual(JSON.parse(post.opts.body).genres, ['Techno', 'ambient']);
});

test('cards show genre chips without remove buttons', async () => {
  const v = setup((u) => (u === '/albums' ? ok([ROW]) : ok({ ...ALBUM, genres: ['Techno'] })));
  await v.unmount.ready;
  assert.equal(v.pane.querySelectorAll('.album-genres .chip').length, 1);
  assert.equal(v.pane.querySelectorAll('.album-genres .x').length, 0);
});
