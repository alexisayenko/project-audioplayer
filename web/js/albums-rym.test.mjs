import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { initPlayer } = await import('./player.js');
initPlayer();
const { store } = await import('./store.js');
const { mountAlbums, openAddAlbum, albumLinks, linkErrorText, LINK_KEYS } = await import('./albums.js');

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
const editBtn = (dlg) => dlg.querySelector('.album-edit-links');
const input = (dlg, key) => dlg.querySelector(`.album-links-form input[data-key="${key}"]`);

test('albumLinks reads the four keys, ignores bad values, keeps the legacy fallbacks', () => {
  assert.deepEqual(albumLinks({ links: { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://youtu.be/x', wikipedia: 'not a url' } }), { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://youtu.be/x' });
  assert.deepEqual(albumLinks({ source: 'discogs:545650', rymUrl: RYM }), { discogs: 'https://www.discogs.com/release/545650', rateyourmusic: RYM });
  assert.deepEqual(albumLinks({ links: { discogs: null, rateyourmusic: null }, source: 'discogs:1', rymUrl: RYM }), {});
  assert.equal(LINK_KEYS.length, 4);
});

test('the info box row shows one icon per set link in a new tab, plus an Edit links toggle; the old RYM field is gone', async () => {
  const album = { ...ALBUM, links: { discogs: DISCOGS, rateyourmusic: RYM, youtube: 'https://www.youtube.com/playlist?list=PL1', wikipedia: 'https://en.wikipedia.org/wiki/Tumult' } };
  const v = await open(() => ok(album));
  const row = v.dlg.querySelector('.album-links');
  for (const [cls, href] of [['.svc-youtube', 'https://www.youtube.com/playlist?list=PL1'], ['.svc-wikipedia', 'https://en.wikipedia.org/wiki/Tumult'], ['.svc-discogs', DISCOGS], ['.svc-rateyourmusic', RYM]]) {
    const a = row.querySelector(cls);
    assert.equal(a.getAttribute('href'), href, cls);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
  }
  assert.ok(editBtn(v.dlg));
  assert.equal(v.dlg.querySelector('form.album-rym'), null);
  assert.equal(v.dlg.querySelector('.album-links-form'), null);
  v.dlg.close();
});

test('with no links only the Edit links toggle shows', async () => {
  const v = await open(() => ok(ALBUM));
  assert.equal(v.dlg.querySelectorAll('.album-links .svc').length, 0);
  assert.ok(editBtn(v.dlg));
  v.dlg.close();
});

test('Edit links reveals four labelled visible inputs with Save and Cancel; Cancel hides them', async () => {
  const v = await open(() => ok({ ...ALBUM, links: { ...NO_LINKS, discogs: DISCOGS } }));
  fire(editBtn(v.dlg), 'click');
  const form = v.dlg.querySelector('.album-links-form');
  assert.ok(form);
  const inputs = [...form.querySelectorAll('input')];
  assert.deepEqual(inputs.map((i) => i.getAttribute('aria-label')), ['Discogs', 'Rate Your Music', 'YouTube', 'Wikipedia']);
  assert.equal(inputs[0].value, DISCOGS);
  assert.ok(inputs.every((i) => i.tagName === 'INPUT' && i.getAttribute('placeholder')));
  const buttons = [...form.querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Cancel', 'Save']);
  fire([...form.querySelectorAll('button')][0], 'click');
  assert.equal(v.dlg.querySelector('.album-links-form'), null);
  v.dlg.close();
});

test('Save sends only the changed keys, empty clears with null, and the row repaints', async () => {
  const saved = { ...ALBUM, links: { ...NO_LINKS, rateyourmusic: RYM } };
  const v = await open((u, o) => (o.method === 'PATCH' ? ok(saved) : ok({ ...ALBUM, links: { ...NO_LINKS, discogs: DISCOGS } })));
  fire(editBtn(v.dlg), 'click');
  input(v.dlg, 'rateyourmusic').value = `  ${RYM} `;
  input(v.dlg, 'discogs').value = '';
  await submit(v.dlg.querySelector('.album-links-form'));
  const patch = v.calls.find((c) => c.opts.method === 'PATCH');
  assert.equal(patch.url, '/albums/alb_1');
  assert.deepEqual(JSON.parse(patch.opts.body), { links: { rateyourmusic: RYM, discogs: null } });
  assert.equal(v.dlg.querySelector('.album-links-form'), null);
  assert.equal(v.dlg.querySelector('.album-links .svc-rateyourmusic').getAttribute('href'), RYM);
  assert.equal(v.dlg.querySelector('.album-links .svc-discogs'), null);
  v.dlg.close();
});

test('Save with nothing changed makes no request', async () => {
  const v = await open(() => ok(ALBUM));
  fire(editBtn(v.dlg), 'click');
  await submit(v.dlg.querySelector('.album-links-form'));
  assert.equal(v.calls.some((c) => c.opts.method === 'PATCH'), false);
  assert.equal(v.dlg.querySelector('.album-links-form'), null);
  v.dlg.close();
});

test('422 bad_link shows the error under that field and keeps the typed text', async () => {
  const v = await open((u, o) => (o.method === 'PATCH' ? { status: 422, body: { error: 'bad_link', key: 'youtube' } } : ok(ALBUM)));
  fire(editBtn(v.dlg), 'click');
  input(v.dlg, 'youtube').value = 'https://example.com/x';
  await submit(v.dlg.querySelector('.album-links-form'));
  const field = input(v.dlg, 'youtube').parentNode;
  const err = field.querySelector('.msg.error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, linkErrorText('YouTube'));
  assert.equal(input(v.dlg, 'youtube').value, 'https://example.com/x');
  assert.equal(input(v.dlg, 'discogs').parentNode.querySelector('.msg.error').hidden, true);
  assert.equal(v.dlg.querySelector('.album-links-form button[type=submit]').disabled, false);
  v.dlg.close();
});

test('Add Album preview keeps one optional Rate Your Music field, sent as links.rateyourmusic only when filled', async () => {
  const PREVIEW = { title: 'Tumult', artist: 'Derango', year: 2004, source: 'discogs:545650', tracks: [{ no: 1, title: 'Intro', durationS: 65 }] };
  const posts = [];
  stubFetch((u, o) => {
    if (u === '/albums/preview') return ok(PREVIEW);
    if (u === '/albums' && o.method === 'POST') { posts.push(JSON.parse(o.body)); return ok({ ...ALBUM }, 201); }
    return ok([]);
  });
  for (const rym of ['', RYM]) {
    openAddAlbum();
    const dlg = document.getElementById('add-dialog');
    dlg.querySelector('.well input').value = DISCOGS;
    await submit(dlg.querySelector('.well'));
    const fields = dlg.querySelectorAll('.album-preview .album-rym input');
    assert.equal(fields.length, 1);
    assert.equal(fields[0].getAttribute('aria-label'), 'Rate Your Music link');
    fields[0].value = rym;
    fire([...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Create')), 'click');
    for (let i = 0; i < 6; i++) await flush();
  }
  assert.equal('links' in posts[0], false);
  assert.deepEqual(posts[1].links, { rateyourmusic: RYM });
});

test('regression: link inputs are real text inputs and the sheet button rule cannot stretch Save', async () => {
  const v = await open(() => ok(ALBUM));
  fire(editBtn(v.dlg), 'click');
  const fieldInputs = [...v.dlg.querySelectorAll('.album-link-field input')];
  assert.equal(fieldInputs.length, 4);
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../albums.css', import.meta.url), 'utf8');
  assert.match(css, /\.album-links-actions \.btn \{[^}]*width: auto/);
  assert.match(css, /\.album-link-field input \{[^}]*width: 100%/);
  v.dlg.close();
});
