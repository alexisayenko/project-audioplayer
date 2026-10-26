import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { mountAlbums, openAddAlbum, RYM_ERROR } = await import('./albums.js');

const ROW = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 1, created_at: '2026-10-26T10:00:00Z' };
const ALBUM = { ...ROW, source: 'discogs:545650', rymUrl: null, tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: null }] };
const RYM = 'https://rateyourmusic.com/release/album/derango/tumult/';
const ok = (body, status = 200) => ({ status, body });

async function open(handler) {
  store.songs = [];
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch((u, o) => (u === '/albums' ? ok([ROW]) : handler(u, o)));
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  fire(pane.querySelector('.album-name-btn'), 'click');
  return { calls, dlg: document.getElementById('song-card') };
}
const submit = async (form) => { fire(form, 'submit'); for (let i = 0; i < 5; i++) await flush(); };

test('info box has a RateYourMusic field; no RYM badge while unset', async () => {
  const v = await open(() => ok(ALBUM));
  const input = v.dlg.querySelector('.album-rym input');
  assert.equal(input.getAttribute('aria-label'), 'RateYourMusic link');
  assert.equal(input.value, '');
  assert.equal(v.dlg.querySelector('.svc-rym'), null);
  v.dlg.close();
});

test('Save PATCHes rymUrl, repaints and shows the RYM link icon next to Discogs', async () => {
  const saved = { ...ALBUM, rymUrl: RYM };
  const v = await open((u, o) => (o.method === 'PATCH' ? ok(saved) : ok(ALBUM)));
  v.dlg.querySelector('.album-rym input').value = `  ${RYM} `;
  await submit(v.dlg.querySelector('form.album-rym'));
  const patch = v.calls.find((c) => c.opts.method === 'PATCH');
  assert.equal(patch.url, '/albums/alb_1');
  assert.deepEqual(JSON.parse(patch.opts.body), { rymUrl: RYM });
  const row = v.dlg.querySelector('.svc-row');
  assert.ok(row.querySelector('.svc-discogs'));
  const a = row.querySelector('.svc-rym');
  assert.equal(a.getAttribute('href'), RYM);
  assert.equal(a.getAttribute('target'), '_blank');
  assert.match(a.getAttribute('rel'), /noopener/);
  assert.equal(v.dlg.querySelector('.album-rym input').value, RYM);
  v.dlg.close();
});

test('empty field clears (null)', async () => {
  const v = await open((u, o) => (o.method === 'PATCH' ? ok(ALBUM) : ok({ ...ALBUM, rymUrl: RYM })));
  v.dlg.querySelector('.album-rym input').value = '';
  await submit(v.dlg.querySelector('form.album-rym'));
  assert.deepEqual(JSON.parse(v.calls.find((c) => c.opts.method === 'PATCH').opts.body), { rymUrl: null });
  assert.equal(v.dlg.querySelector('.svc-rym'), null);
  v.dlg.close();
});

test('422 bad_rym_url shows the inline error and keeps the field', async () => {
  const v = await open((u, o) => (o.method === 'PATCH' ? { status: 422, body: { error: 'bad_rym_url', detail: 'bad' } } : ok(ALBUM)));
  v.dlg.querySelector('.album-rym input').value = 'https://example.com/x';
  await submit(v.dlg.querySelector('form.album-rym'));
  const err = v.dlg.querySelector('.album-rym .msg.error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, RYM_ERROR);
  assert.equal(v.dlg.querySelector('.album-rym input').value, 'https://example.com/x');
  v.dlg.close();
});

test('Add Album preview has the optional field and sends rymUrl only when filled', async () => {
  const PREVIEW = { title: 'Tumult', artist: 'Derango', year: 2004, source: 'discogs:545650', tracks: [{ no: 1, title: 'Intro', durationS: 65 }] };
  let posts = [];
  stubFetch((u, o) => {
    if (u === '/albums/preview') return ok(PREVIEW);
    if (u === '/albums' && o.method === 'POST') { posts.push(JSON.parse(o.body)); return ok({ ...ALBUM }, 201); }
    return ok([]);
  });
  for (const rym of ['', RYM]) {
    openAddAlbum();
    const dlg = document.getElementById('add-dialog');
    dlg.querySelector('.well input').value = 'https://www.discogs.com/release/545650-Derango-Tumult';
    await submit(dlg.querySelector('.well'));
    const field = dlg.querySelector('.album-preview .album-rym input');
    assert.ok(field);
    field.value = rym;
    fire([...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Create')), 'click');
    for (let i = 0; i < 6; i++) await flush();
  }
  assert.equal('rymUrl' in posts[0], false);
  assert.equal(posts[1].rymUrl, RYM);
});
