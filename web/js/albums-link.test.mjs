import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { mountAlbums, linkCandidates, candidateMeta } = await import('./albums.js');

const ROW = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 3, created_at: '2026-10-26T10:00:00Z' };
const TRACKS = [
  { no: 1, title: 'Intro', durationS: 65, songId: null },
  { no: 2, title: 'Noise', durationS: 200, songId: 's2' },
  { no: 3, title: 'Outro', durationS: 90, songId: null },
];
const ALBUM = { ...ROW, source: 'discogs:1', tracks: TRACKS };
const SONGS = [
  { id: 's1', title: 'Intro', artist: 'Derango', file: 'a.mp3', duration: 66, albums: ['Tumult'], year: 2004 },
  { id: 's2', title: 'Noise', artist: 'Derango', file: 'b.mp3', duration: 201 },
  { id: 's3', title: 'Other song', artist: 'Someone', file: 'c.mp3', duration: 100, albums: ['tumult'] },
  { id: 's4', title: 'intro', artist: 'DERANGO', file: 'd.mp3' },
  { id: 's5', title: 'Intro', artist: 'Another Band', file: 'e.mp3', duration: 50 },
];
const ok = (body, status = 200) => ({ status, body });

async function open(handler) {
  store.songs = SONGS;
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch((u, o) => (u === '/albums' ? ok([ROW]) : handler(u, o)));
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  fire(pane.querySelector('.album-name-btn'), 'click');
  return { pane, calls, dlg: document.getElementById('song-card') };
}

test('candidates: title AND artist (folded) or same album, exclude songs linked to other tracks, best first', () => {
  const ids = linkCandidates(ALBUM, TRACKS[0], SONGS).map((s) => s.id);
  assert.deepEqual(ids, ['s1', 's4', 's3']);
  assert.equal(ids.includes('s2'), false);
  assert.equal(ids.includes('s5'), false);
});

test('candidate meta: Artist · Album · year, unknown parts omitted', () => {
  assert.equal(candidateMeta(SONGS[0]), 'Derango · Tumult · 2004');
  assert.equal(candidateMeta(SONGS[3]), 'DERANGO');
});

test('unlinked track shows Link song; the popup has a search field and lists entries with title attribute', async () => {
  const v = await open(() => ok(ALBUM));
  const rows = [...v.dlg.querySelectorAll('.album-info-tracks li')];
  assert.equal(rows.length, 3);
  assert.ok(rows[0].querySelector('.album-link-btn'));
  assert.equal(rows[1].querySelector('.album-link-btn'), null);
  assert.match(rows[1].querySelector('.album-linked').textContent, /Derango - Noise3:21/);
  assert.equal(rows[1].querySelector('button.album-linked-name').textContent, 'Derango - Noise');
  assert.ok(rows[1].querySelector('.album-unlink.sq-btn'));
  assert.equal(rows[1].querySelector('.album-unlink').classList.contains('x'), false);
  fire(rows[0].querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  assert.equal(pop.open, true);
  assert.equal(pop.querySelectorAll('input').length, 1);
  assert.equal(pop.querySelector('input').type, 'search');
  const items = [...pop.querySelectorAll('li.song')];
  assert.equal(items.length, 3);
  assert.equal(items[0].querySelector('.open').textContent, 'Intro');
  assert.equal(items[0].querySelector('.sub').textContent, 'Derango · Tumult · 2004');
  assert.equal(items[0].querySelector('.title-len').textContent, '1:06');
  assert.equal(items[1].querySelector('.title-len').textContent, '-');
  assert.equal(items[0].querySelector('.bpm-badge'), null);
  const box = pop.querySelector('input');
  box.value = 'another';
  fire(box, 'input');
  assert.deepEqual([...pop.querySelectorAll('li.song')].map((li) => li.dataset.id), ['s5']);
  box.value = 'zzzz';
  fire(box, 'input');
  assert.match(pop.textContent, /No matching songs in your library/);
  box.value = '';
  fire(box, 'input');
  assert.equal(pop.querySelectorAll('li.song').length, 3);
  pop.close();
  v.dlg.close();
});

test('empty state when nothing matches', async () => {
  const v = await open(() => ok({ ...ALBUM, tracks: [{ no: 1, title: 'Zzz', durationS: 1, songId: null }], artist: 'Nobody', title: 'Nope' }));
  fire(v.dlg.querySelector('.album-link-btn'), 'click');
  assert.match(document.getElementById('pl-dialog').textContent, /No matching songs in your library/);
  document.getElementById('pl-dialog').close();
  v.dlg.close();
});

test('picking a song PUTs, closes the popup and refreshes the info box', async () => {
  const linked = { ...ALBUM, tracks: [{ ...TRACKS[0], songId: 's1' }, TRACKS[1], TRACKS[2]] };
  const v = await open((u, o) => (o.method === 'PUT' ? ok(linked) : ok(ALBUM)));
  fire(v.dlg.querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  fire(pop.querySelector('li.song .open'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  const put = v.calls.find((c) => c.opts.method === 'PUT');
  assert.equal(put.url, '/albums/alb_1/tracks/1/song');
  assert.deepEqual(JSON.parse(put.opts.body), { songId: 's1' });
  assert.equal(pop.open, false);
  assert.match(v.dlg.querySelectorAll('.album-info-tracks li')[0].querySelector('.album-linked').textContent, /Derango - Intro1:06/);
  v.dlg.close();
});

test('409 already_linked shows an error in the popup', async () => {
  const v = await open((u, o) => (o.method === 'PUT' ? { status: 409, body: { error: 'already_linked', no: 1 } } : ok(ALBUM)));
  fire(v.dlg.querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  fire(pop.querySelector('li.song .open'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  assert.match(pop.querySelector('.msg.error').textContent, /already linked/);
  pop.close();
  v.dlg.close();
});

test('the unlink x DELETEs and the row goes back to Link song', async () => {
  const unlinked = { ...ALBUM, tracks: TRACKS.map((t) => ({ ...t, songId: null })) };
  const v = await open((u, o) => (o.method === 'DELETE' ? ok(unlinked) : ok(ALBUM)));
  fire(v.dlg.querySelector('.album-unlink'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  const del = v.calls.find((c) => c.opts.method === 'DELETE');
  assert.equal(del.url, '/albums/alb_1/tracks/2/song');
  assert.equal(v.dlg.querySelectorAll('.album-link-btn').length, 3);
  v.dlg.close();
});

test('a linked song with unknown length shows a dash', async () => {
  store.songs = [{ id: 's2', title: 'Noise', artist: 'Derango', file: 'b.mp3' }];
  const v = await open(() => ok(ALBUM));
  store.songs = [{ id: 's2', title: 'Noise', artist: 'Derango', file: 'b.mp3' }];
  v.dlg.close();
  assert.equal(candidateMeta(store.songs[0]), 'Derango');
});

test('tracks are an accordion: sub-row collapsed by default; Link icon when free, Unlink icon with name and length when linked', async () => {
  const v = await open(() => ok(ALBUM));
  const lis = [...v.dlg.querySelectorAll('.album-info-tracks li')];
  assert.equal(lis[0].querySelector('.album-row-btn'), null, 'an unlinked track is not an accordion');
  assert.equal(lis[0].querySelector('.album-panel'), null);
  assert.ok(lis[0].querySelector('.album-track-line .album-link-btn'), 'the link icon is on the collapsed row');
  for (const li of lis.filter((x) => x.querySelector('.album-row-btn'))) {
    assert.ok(li.querySelector('.album-linked'));
    assert.equal(li.querySelector('.album-row-btn').getAttribute('aria-expanded'), 'false');
    assert.equal(li.querySelector('.album-panel').hidden, true);
  }
  fire(lis[1].querySelector('.album-row-btn'), 'click');
  assert.equal(lis[1].querySelector('.album-row-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(lis[1].querySelector('.album-panel').hidden, false);
  const free = lis[0].querySelector('.album-link-btn');
  assert.equal(free.getAttribute('aria-label'), 'Link a song');
  assert.equal(free.title, 'Link a song');
  const un = lis[1].querySelector('.album-unlink');
  assert.equal(un.getAttribute('aria-label'), 'Unlink song');
  assert.equal(un.title, 'Unlink song');
  assert.equal(lis[1].querySelector('.album-linked').children[2].textContent, '3:21');
  assert.equal(lis[1].querySelector('.album-play'), null);
  v.dlg.close();
});

test('linking a track swaps its Link icon for the Unlink sub-row', async () => {
  const linked = { ...ALBUM, tracks: [{ ...TRACKS[0], songId: 's1' }, TRACKS[1], TRACKS[2]] };
  const v = await open((u, o) => (o.method === 'PUT' ? ok(linked) : ok(ALBUM)));
  fire(v.dlg.querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  fire(pop.querySelector('li.song .open'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  const first = v.dlg.querySelectorAll('.album-info-tracks li')[0];
  assert.ok(first.querySelector('.album-unlink'));
  assert.equal(first.querySelector('.album-link-btn'), null);
  v.dlg.close();
});


