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

test('unlinked track shows Link song; the popup lists entries with title attribute, no text input', async () => {
  const v = await open(() => ok(ALBUM));
  const rows = [...v.dlg.querySelectorAll('.album-info-tracks li')];
  assert.equal(rows.length, 3);
  assert.ok(rows[0].querySelector('.album-link-btn'));
  assert.equal(rows[1].querySelector('.album-link-btn'), null);
  assert.match(rows[1].querySelector('.album-linked').textContent, /Derango - Noise3:21/);
  fire(rows[0].querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  assert.equal(pop.open, true);
  assert.equal(pop.querySelectorAll('input').length, 0);
  const items = [...pop.querySelectorAll('li.song')];
  assert.equal(items.length, 3);
  assert.equal(items[0].querySelector('.open').textContent, 'Intro');
  assert.equal(items[0].querySelector('.sub').textContent, 'Derango · Tumult · 2004');
  assert.equal(items[0].querySelector('.title-len').textContent, '1:06');
  assert.equal(items[1].querySelector('.title-len').textContent, '-');
  assert.equal(items[0].querySelector('.bpm-badge'), null);
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

test('track accordion: collapsed by default, one open at a time, toggle, accessible buttons', async () => {
  const v = await open(() => ok(ALBUM));
  const lis = () => [...v.dlg.querySelectorAll('.album-info-tracks li')];
  const state = () => lis().map((li) => [li.querySelector('.album-row-btn').getAttribute('aria-expanded'), li.querySelector('.album-panel').hidden]);
  assert.deepEqual(state(), [['false', true], ['false', true], ['false', true]]);
  for (const li of lis()) {
    const b = li.querySelector('.album-row-btn');
    assert.equal(b.tagName, 'BUTTON');
    assert.equal(b.getAttribute('aria-controls'), li.querySelector('.album-panel').id);
  }
  fire(lis()[0].querySelector('.album-row-btn'), 'click');
  assert.deepEqual(state(), [['true', false], ['false', true], ['false', true]]);
  fire(lis()[2].querySelector('.album-row-btn'), 'click');
  assert.deepEqual(state(), [['false', true], ['false', true], ['true', false]]);
  fire(lis()[2].querySelector('.album-row-btn'), 'click');
  assert.deepEqual(state(), [['false', true], ['false', true], ['false', true]]);
  v.dlg.close();
});

test('linking inside an open panel keeps that panel open', async () => {
  const linked = { ...ALBUM, tracks: [{ ...TRACKS[0], songId: 's1' }, TRACKS[1], TRACKS[2]] };
  const v = await open((u, o) => (o.method === 'PUT' ? ok(linked) : ok(ALBUM)));
  fire(v.dlg.querySelectorAll('.album-row-btn')[0], 'click');
  fire(v.dlg.querySelector('.album-link-btn'), 'click');
  const pop = document.getElementById('pl-dialog');
  fire(pop.querySelector('li.song .open'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  const first = v.dlg.querySelectorAll('.album-info-tracks li')[0];
  assert.equal(first.querySelector('.album-row-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(first.querySelector('.album-panel').hidden, false);
  assert.ok(first.querySelector('.album-unlink'));
  v.dlg.close();
});

test('arrow keys move focus between track rows; Home and End jump', async () => {
  const v = await open(() => ok(ALBUM));
  const rows = () => [...v.dlg.querySelectorAll('.album-row-btn')];
  rows()[0].focus();
  fire(rows()[0], 'keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, rows()[1]);
  fire(rows()[1], 'keydown', { key: 'End' });
  assert.equal(document.activeElement, rows()[2]);
  fire(rows()[2], 'keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement, rows()[1]);
  fire(rows()[1], 'keydown', { key: 'Home' });
  assert.equal(document.activeElement, rows()[0]);
  fire(rows()[0], 'keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement, rows()[0]);
  v.dlg.close();
});
