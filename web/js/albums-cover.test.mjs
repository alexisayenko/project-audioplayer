import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { mountAlbums, openAlbumEdit } = await import('./albums.js');
const { albumCoverSection, sourceNote } = await import('./albums-cover.js');

const ok = (body, status = 200) => ({ status, body });
const ROW = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 1, created_at: '2026-10-26T10:00:00Z' };
const COVER = '/albums/alb_1/cover?v=abc';
const ALBUM = { ...ROW, source: 'discogs:1', links: {}, tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: null }], cover: { source: 'discogs', url: 'https://img.discogs.com/a.jpg' }, coverUrl: COVER, coverFrom: 'album' };
const NONE = { ...ALBUM, cover: { source: null, url: null }, coverUrl: null, coverFrom: null };
const CANDS = [
  { source: 'discogs', url: 'https://img.discogs.com/a.jpg', thumb: 'https://img.discogs.com/a-t.jpg', width: 600, height: 600, label: 'Discogs' },
  { source: 'wikipedia', url: 'https://upload.wikimedia.org/b.jpg', thumb: null, width: null, height: null, label: 'Wikipedia' },
  { source: 'youtube', url: 'https://i.ytimg.com/c.jpg', thumb: 'https://i.ytimg.com/c-t.jpg', width: 480, height: 360, label: 'YouTube' },
];
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };

async function openList(album, extra = () => null) {
  store.songs = [];
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch((u, o) => extra(u, o) || (u === '/albums' ? ok([ROW]) : ok(album)));
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  return { pane, calls, q: (s) => pane.querySelector(s) };
}

test('list row: the cover image comes from coverUrl, lazy, and falls back to the placeholder', async () => {
  const v = await openList(ALBUM);
  const img = v.q('li.album-row .row-cover img.cover');
  assert.equal(img.getAttribute('src'), COVER);
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.ok(v.q('li.album-row .row-cover .cover-mark'));
  assert.ok(v.q('li.album-row .row-cover .rc-ov'), 'the play overlay is kept');
  fire(img, 'error');
  assert.equal(img.getAttribute('src'), null);

  const none = await openList(NONE);
  assert.equal(none.q('li.album-row .row-cover img.cover').getAttribute('src'), null);
  assert.ok(none.q('li.album-row .row-cover .cover-mark'));
});

test('info box: the cover fits the square art with alt "Artist - Album cover"; the placeholder stays without a cover or on error', async () => {
  const v = await openList(ALBUM);
  fire(v.q('.album-name-btn'), 'click');
  const dlg = document.getElementById('song-card');
  const img = dlg.querySelector('.card-art img.card-cover');
  assert.equal(img.getAttribute('src'), COVER);
  assert.equal(img.getAttribute('alt'), 'Derango - Tumult cover');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.ok(dlg.querySelector('.card-art .cover-mark'));
  fire(img, 'error');
  assert.equal(img.getAttribute('src'), null);
  dlg.close();

  const none = await openList(NONE);
  fire(none.q('.album-name-btn'), 'click');
  assert.equal(dlg.querySelector('.card-art img.card-cover').getAttribute('src'), null);
  assert.ok(dlg.querySelector('.card-art .cover-mark'));
  dlg.close();
});

test('sourceNote names where the cover comes from', () => {
  assert.equal(sourceNote(ALBUM), 'Own cover (Discogs)');
  assert.equal(sourceNote({ ...NONE, coverFrom: 'song', coverUrl: '/covers/x' }), 'Showing the cover of the first linked song');
  assert.equal(sourceNote(NONE), 'No cover yet');
});

function section(album, handler) {
  const a = { ...album };
  const calls = stubFetch(handler);
  const changed = [];
  const sec = albumCoverSection(a, (full) => changed.push(full));
  document.body.append(sec.node);
  return { a, calls, changed, sec, q: (s) => sec.node.querySelector(s), qa: (s) => [...sec.node.querySelectorAll(s)] };
}

test('cover section: preview, loading then candidate thumbs with source labels, click selects and saves via PUT', async () => {
  const saved = { ...ALBUM, cover: { source: 'youtube', url: CANDS[2].url }, coverUrl: '/albums/alb_1/cover?v=new', coverFrom: 'album' };
  const s = section(ALBUM, (u, o) => (u === '/albums/alb_1/cover/candidates' ? ok({ candidates: CANDS }) : o.method === 'PUT' ? ok(saved) : ok({})));
  assert.equal(s.q('.cover-edit-img').getAttribute('src'), COVER);
  assert.equal(s.q('.album-cover-note').textContent, 'Own cover (Discogs)');
  assert.match(s.sec.node.textContent, /Looking for covers/);
  await settle();
  const thumbs = s.qa('.album-cover-cand');
  assert.deepEqual(thumbs.map((t) => t.querySelector('span').textContent), ['Discogs', 'Wikipedia', 'YouTube']);
  assert.equal(thumbs[0].getAttribute('aria-pressed'), 'true');
  assert.equal(thumbs[1].getAttribute('aria-pressed'), 'false');
  assert.equal(thumbs[0].querySelector('img').getAttribute('loading'), 'lazy');
  assert.equal(thumbs[1].querySelector('img').getAttribute('src'), CANDS[1].url, 'a missing thumb falls back to the image address');
  assert.match(thumbs[0].textContent, /600×600/);
  fire(thumbs[2], 'click');
  await settle();
  const put = s.calls.find((c) => c.opts.method === 'PUT');
  assert.equal(put.url, '/albums/alb_1/cover');
  assert.deepEqual(JSON.parse(put.opts.body), { source: 'youtube', url: CANDS[2].url });
  assert.equal(s.q('.cover-edit-img').getAttribute('src'), '/albums/alb_1/cover?v=new');
  assert.equal(s.a.coverUrl, '/albums/alb_1/cover?v=new');
  assert.equal(s.changed.length, 1);
  assert.equal(s.qa('.album-cover-cand')[2].getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('toast').textContent, 'Cover updated');
});

test('cover section: empty and failed candidate loads', async () => {
  const empty = section(ALBUM, () => ok({ candidates: [] }));
  await settle();
  assert.match(empty.sec.node.textContent, /No covers found/);
  assert.equal(empty.qa('.album-cover-cand').length, 0);
  const failed = section(ALBUM, () => ({ status: 500, body: { detail: 'down' } }));
  await settle();
  assert.match(failed.sec.node.textContent, /Could not load cover suggestions/);
});

test('cover section: Remove cover only for an own cover, DELETE, repaint to the song cover', async () => {
  const after = { ...ALBUM, cover: { source: null, url: null }, coverUrl: '/covers/s1?v=1', coverFrom: 'song' };
  const s = section(ALBUM, (u, o) => (o.method === 'DELETE' ? ok(after) : ok({ candidates: [] })));
  assert.equal(s.q('.album-cover-remove').hidden, false);
  fire(s.q('.album-cover-remove'), 'click');
  await settle();
  assert.equal(s.calls.find((c) => c.opts.method === 'DELETE').url, '/albums/alb_1/cover');
  assert.equal(s.q('.album-cover-remove').hidden, true);
  assert.equal(s.q('.cover-edit-img').getAttribute('src'), '/covers/s1?v=1');
  assert.equal(s.q('.album-cover-note').textContent, 'Showing the cover of the first linked song');

  const song = section({ ...ALBUM, coverFrom: 'song', cover: { source: null, url: null } }, () => ok({ candidates: [] }));
  assert.equal(song.q('.album-cover-remove').hidden, true);
  const none = section(NONE, () => ok({ candidates: [] }));
  assert.equal(none.q('.album-cover-remove').hidden, true);
  assert.equal(none.q('.cover-edit-img').classList.contains('noart'), true);
});

test('cover section: Upload image sends the raw file as the body with its content type; bad files are refused in the browser', async () => {
  const uploaded = { ...ALBUM, cover: { source: 'upload', url: null }, coverUrl: '/albums/alb_1/cover?v=up', coverFrom: 'album' };
  const s = section(NONE, (u, o) => (o.method === 'PUT' ? ok(uploaded) : ok({ candidates: [] })));
  const fileIn = s.q('input[type=file]');
  fileIn.files = [new File(['x'], 'a.gif', { type: 'image/gif' })];
  fire(fileIn, 'change');
  await settle();
  assert.match(s.sec.node.textContent, /Use a JPEG, PNG or WebP image/);
  assert.equal(s.calls.some((c) => c.opts.method === 'PUT'), false);
  fileIn.files = [new File(['x'], 'a.png', { type: 'image/png' })];
  fire(fileIn, 'change');
  await settle();
  const put = s.calls.find((c) => c.opts.method === 'PUT');
  assert.equal(put.url, '/albums/alb_1/cover');
  assert.equal(put.opts.headers['Content-Type'], 'image/png');
  assert.ok(put.opts.body instanceof File);
  assert.equal(s.q('.cover-edit-img').getAttribute('src'), '/albums/alb_1/cover?v=up');
  assert.equal(s.q('.album-cover-note').textContent, 'Own cover (an upload)');
});

test('cover section: a server error stays inline and keeps the controls usable', async () => {
  const s = section(ALBUM, (u, o) => (o.method === 'PUT' ? { status: 422, body: { error: 'bad_image', detail: 'That image could not be read.' } } : ok({ candidates: CANDS })));
  await settle();
  fire(s.qa('.album-cover-cand')[1], 'click');
  await settle();
  assert.match(s.sec.node.textContent, /That image could not be read/);
  assert.equal(s.qa('.album-cover-cand')[1].disabled, false);
  assert.equal(s.q('.cover-edit-img').getAttribute('src'), COVER);
});

test('Edit dialog has the Cover section first; a cover change repaints the info box without closing the dialog', async () => {
  const saved = { ...ALBUM, cover: { source: 'wikipedia', url: CANDS[1].url }, coverUrl: '/albums/alb_1/cover?v=w', coverFrom: 'album' };
  stubFetch((u, o) => (u === '/albums/alb_1/cover/candidates' ? ok({ candidates: CANDS }) : o.method === 'PUT' ? ok(saved) : ok({})));
  const dlg = document.getElementById('edit-dialog');
  let got = null;
  openAlbumEdit({ ...ALBUM }, (full) => { got = full; });
  const form = dlg.querySelector('form');
  assert.ok(form.querySelector('.album-cover-edit'));
  assert.equal(form.childNodes[1].className.includes('album-cover-edit'), true);
  await settle();
  fire(dlg.querySelectorAll('.album-cover-cand')[1], 'click');
  await settle();
  assert.equal(got.coverUrl, '/albums/alb_1/cover?v=w');
  assert.equal(dlg.open, true);
  dlg.close();
});
