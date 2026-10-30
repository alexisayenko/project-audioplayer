import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { mountAlbums, albumLinks, linkErrorText, LINK_KEYS } = await import('./albums.js');

const ROW = { id: 'alb_1', title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 1, created_at: '2026-10-26T10:00:00Z' };
const NO_LINKS = { discogs: null, rateyourmusic: null, youtube: null, wikipedia: null };
const ALBUM = { ...ROW, source: 'discogs:545650', links: { ...NO_LINKS }, tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: null }] };
const RYM = 'https://rateyourmusic.com/release/album/derango/tumult/';
const DISCOGS = 'https://www.discogs.com/release/545650-Derango-Tumult';
const ok = (body, status = 200) => ({ status, body });

async function open(handler, album = ALBUM) {
  store.songs = [];
  const pane = document.createElement('div');
  document.body.append(pane);
  const calls = stubFetch((u, o) => (u === '/albums' ? ok([ROW]) : handler(u, o)));
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  fire(pane.querySelector('.album-name-btn'), 'click');
  return { calls, dlg: document.getElementById('song-card'), album };
}
const submit = async (form) => { fire(form, 'submit'); for (let i = 0; i < 5; i++) await flush(); };
const openEdit = (v) => { fire(v.dlg.querySelector('.act-edit'), 'click'); return document.getElementById('edit-dialog'); };
const input = (edit, key) => edit.querySelector(`.lk-row input[data-key="${key}"]`);

test('albumLinks reads the four keys, ignores bad values, keeps the legacy fallbacks', () => {
  assert.deepEqual(albumLinks({ links: { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://youtu.be/x', wikipedia: 'not a url' } }), { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://youtu.be/x' });
  assert.deepEqual(albumLinks({ source: 'discogs:545650', rymUrl: RYM }), { discogs: 'https://www.discogs.com/release/545650', rateyourmusic: RYM });
  assert.deepEqual(albumLinks({ links: { discogs: null, rateyourmusic: null }, source: 'discogs:1', rymUrl: RYM }), {});
  assert.equal(LINK_KEYS.length, 5);
});

test('the info box row shows one icon per set link in a new tab; no Edit links toggle, no inline form, no old RYM field', async () => {
  const album = { ...ALBUM, links: { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://www.youtube.com/playlist?list=PL1', wikipedia: 'https://en.wikipedia.org/wiki/Tumult' } };
  const v = await open(() => ok(album));
  const row = v.dlg.querySelector('.album-links');
  for (const [cls, href] of [['.svc-youtube', 'https://www.youtube.com/playlist?list=PL1'], ['.svc-wikipedia', 'https://en.wikipedia.org/wiki/Tumult'], ['.svc-discogs', DISCOGS], ['.svc-rateyourmusic', RYM]]) {
    const a = row.querySelector(cls);
    assert.equal(a.getAttribute('href'), href, cls);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
  }
  assert.equal(v.dlg.querySelector('form.album-rym'), null);
  assert.equal(v.dlg.querySelector('.album-links-form'), null);
  assert.equal([...v.dlg.querySelectorAll('button')].some((b) => b.textContent === 'Edit links'), false);
  v.dlg.close();
});

test('with no links the info box shows no link row', async () => {
  const v = await open(() => ok(ALBUM));
  assert.equal(v.dlg.querySelector('.album-links'), null);
  v.dlg.close();
});

test('the Edit dialog has the Links panel with labelled inputs, prefilled', async () => {
  const v = await open(() => ok({ ...ALBUM, links: { ...NO_LINKS, discogs: DISCOGS } }));
  const edit = openEdit(v);
  const inputs = [...edit.querySelectorAll('.lk-row input')];
  assert.deepEqual(inputs.map((i) => i.getAttribute('aria-label')), ['YouTube link', 'Wikipedia: album', 'Discogs link', 'Rate Your Music link', 'Website link']);
  assert.equal(input(edit, 'discogs').value, DISCOGS);
  assert.ok(inputs.every((i) => i.tagName === 'INPUT' && i.getAttribute('placeholder')));
  assert.deepEqual([...edit.querySelectorAll('.row.end > button')].map((b) => b.textContent), ['', 'Delete from library', 'Save']);
  edit.close();
  v.dlg.close();
});

test('Save sends only the changed keys in one PATCH, empty clears with null, and the info box repaints', async () => {
  const saved = { ...ALBUM, links: { ...NO_LINKS, rateyourmusic: RYM } };
  const v = await open((u, o) => (o.method === 'PATCH' ? ok(saved) : ok({ ...ALBUM, links: { ...NO_LINKS, discogs: DISCOGS } })));
  const edit = openEdit(v);
  input(edit, 'rateyourmusic').value = `  ${RYM} `;
  input(edit, 'discogs').value = '';
  await submit(edit.querySelector('form'));
  const patches = v.calls.filter((c) => c.opts.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, '/albums/alb_1');
  assert.deepEqual(JSON.parse(patches[0].opts.body), { links: { rateyourmusic: RYM, discogs: null } });
  assert.equal(edit.open, false);
  assert.equal(v.dlg.querySelector('.album-links .svc-rateyourmusic').getAttribute('href'), RYM);
  assert.equal(v.dlg.querySelector('.album-links .svc-discogs'), null);
  v.dlg.close();
});

test('Save with nothing changed makes no request', async () => {
  const v = await open(() => ok(ALBUM));
  const edit = openEdit(v);
  await submit(edit.querySelector('form'));
  assert.equal(v.calls.some((c) => c.opts.method === 'PATCH'), false);
  assert.equal(edit.open, false);
  v.dlg.close();
});

test('422 bad_link shows the error under that field and keeps the typed text', async () => {
  const v = await open((u, o) => (o.method === 'PATCH' ? { status: 422, body: { error: 'bad_link', key: 'youtube' } } : ok(ALBUM)));
  const edit = openEdit(v);
  input(edit, 'youtube').value = 'https://example.com/x';
  await submit(edit.querySelector('form'));
  const err = input(edit, 'youtube').parentNode.nextSibling;
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, linkErrorText('YouTube'));
  assert.equal(input(edit, 'youtube').value, 'https://example.com/x');
  assert.equal(input(edit, 'discogs').parentNode.nextSibling.hidden, true);
  assert.equal(edit.querySelector('button[type=submit]').disabled, false);
  assert.equal(edit.open, true);
  edit.close();
  v.dlg.close();
});

test('regression: the link inputs sit in the shared Links panel in the Edit dialog, which is not a sheet', async () => {
  const v = await open(() => ok(ALBUM));
  const edit = openEdit(v);
  assert.equal(edit.querySelectorAll('.lk-row input').length, 5);
  assert.equal(edit.classList.contains('sheet'), false);
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../albums.css', import.meta.url), 'utf8');
  assert.match(css, /\.album-link-field input \{[^}]*width: 100%/);
  assert.match(css, /\.album-delete-choice \.btn \{[^}]*width: auto/);
  edit.close();
  v.dlg.close();
});

test('YouTube link: prefilled in the Edit dialog, kept in the info box after saving another key, merged when the reply omits it', async () => {
  const YT = 'https://www.youtube.com/playlist?list=PLabc123';
  const withYt = { ...ALBUM, links: { ...NO_LINKS, youtube: YT } };
  const afterRym = { ...withYt, links: { discogs: null, rateyourmusic: RYM, wikipedia: null } };
  const v = await open((u, o) => (o.method === 'PATCH' ? ok(afterRym) : ok(withYt)));
  assert.equal(v.dlg.querySelector('.svc-youtube').getAttribute('href'), YT);
  const edit = openEdit(v);
  assert.equal(input(edit, 'youtube').value, YT);
  input(edit, 'rateyourmusic').value = RYM;
  await submit(edit.querySelector('form'));
  assert.deepEqual(JSON.parse(v.calls.find((c) => c.opts.method === 'PATCH').opts.body), { links: { rateyourmusic: RYM } });
  assert.equal(v.dlg.querySelector('.album-links .svc-youtube').getAttribute('href'), YT, 'a reply that omits the key does not drop it');
  const again = openEdit(v);
  assert.equal(input(again, 'youtube').value, YT);
  assert.equal(input(again, 'rateyourmusic').value, RYM);
  again.close();
  v.dlg.close();
});

test('the unlink button uses the broken-chain icon (no image file)', async () => {
  const { ICONS, icon } = await import('./icons.js');
  assert.ok(ICONS.unlink);
  assert.equal((ICONS.unlink.d.match(/<path/g) || []).length, 6);
  assert.equal((ICONS.link.d.match(/<path/g) || []).length, 3);
  assert.equal(ICONS.unlink.d.includes('<image'), false);
  assert.equal(icon('unlink', 'inline').getAttribute('viewBox'), '0 0 24 24');
  const album = { ...ALBUM, tracks: [{ no: 1, title: 'Intro', durationS: 65, songId: 'u2' }] };
  const v = await open(() => ok(album));
  const btn = v.dlg.querySelector('.album-unlink');
  assert.equal(btn.getAttribute('title'), 'Unlink song');
  assert.equal(btn.getAttribute('aria-label'), 'Unlink song');
  assert.ok(btn.querySelector('svg'));
  v.dlg.close();
});

test('the website link shows in the album links', () => {
  const url = 'https://iono-music.com/releases/release-2277/';
  assert.equal(albumLinks({ links: { website: url } }).website, url);
  assert.equal(albumLinks({ links: { website: 'javascript:alert(1)' } }).website, undefined);
});
