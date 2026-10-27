import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => {
  const t = realSetTimeout(fn, ms, ...a);
  if (ms > 5000) t.unref?.();
  return t;
};
const { initPlayer } = await import('./player.js');
initPlayer();
const { openAddAlbum } = await import('./albums.js');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PREVIEW = fixture('yt-preview.json');
const PLAYLIST = PREVIEW.playlist.url;
const UPDATE = !!process.env.UPDATE_WEB_FIXTURES;
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush(); };

function server(preview) {
  return stubFetch((u) => {
    if (u === '/albums/youtube/preview') return ok(preview);
    if (u === '/albums/youtube/commit') return ok({ album: { id: 'alb_1', title: 'Twisted' }, songs: [], linked: 0, unlinked: 0 }, 201);
    if (u === '/albums/discogs/search') return ok({ candidates: [], searchError: null });
    if (u === '/albums/genres/suggest') return ok({ suggestions: [], wikipediaPage: null, searchError: null });
    if (u === '/me') return ok({ owner: true });
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [] });
    return ok({});
  });
}

const type = (node, value) => { node.value = value; fire(node, 'input'); };
const next = async () => { fire(q('.wiz-next'), 'click'); await settle(); };

async function popup() {
  openAddAlbum();
  type(q('#wiz-url'), PLAYLIST);
  await next();
  await next();
  await next();
}

function sentBody(calls) {
  return JSON.parse(calls.find((c) => c.url === '/albums/youtube/commit').opts.body);
}

function checkFixture(name, data) {
  const path = new URL(`./fixtures/${name}`, import.meta.url);
  if (UPDATE) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  assert.deepEqual(data, fixture(name), `${name} differs from the recorded request; rerun with UPDATE_WEB_FIXTURES=1 and the server contract test`);
}

test('the real preview response fills step 2 and gives one labelled row per track in the review', async () => {
  server(PREVIEW);
  openAddAlbum();
  type(q('#wiz-url'), PLAYLIST);
  await next();
  assert.deepEqual(qa('.wiz-details .token-field').map((f) => [...f.querySelectorAll('.token-text')].map((p) => p.textContent).join(' - ')), ['Hallucinogen', 'Twisted']);
  assert.equal(q('.wiz-details .album-year').value, '1995');
  await next();
  await next();
  const rows = qa('li.wiz-row');
  assert.equal(rows.length, 11);
  const labels = rows.map((r) => r.querySelector('.av-label').textContent.replace(/\s+/g, ' ').trim());
  assert.equal(labels[0], 'Hallucinogen - LSD (7:30)');
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), Array(11).fill(true));
  assert.equal(rows[0].querySelector('a.av-yt').href, PREVIEW.tracks[0].url);
  D().close();
});

test('Import sends a body of the shape the server takes (recorded and replayed by the server contract test)', async () => {
  const calls = server(PREVIEW);
  await popup();
  await next();
  const sent = sentBody(calls);
  assert.deepEqual(Object.keys(sent).sort(), ['album', 'coverToSongs', 'playlistUrl', 'selected']);
  assert.equal(sent.playlistUrl, PLAYLIST);
  assert.equal(sent.coverToSongs, true);
  assert.deepEqual(sent.album, { title: 'Twisted', albumArtist: 'Hallucinogen', type: 'album', year: 1995, genres: PREVIEW.genres, coverUrl: PREVIEW.album.coverUrl });
  assert.deepEqual(sent.selected.map((s) => s.position), PREVIEW.tracks.map((t) => t.position));
  for (const s of sent.selected) {
    const t = PREVIEW.tracks.find((x) => x.position === s.position);
    assert.deepEqual(s, { position: t.position, videoId: t.videoId, title: t.title, durationS: t.durationS, artists: t.artists, version: t.version, trackNo: t.position });
  }
  checkFixture('yt-commit-album-request.json', sent);
  D().close();
});

test('Back sends nothing beyond the preview and the Discogs search', async () => {
  const calls = server(PREVIEW);
  openAddAlbum();
  type(q('#wiz-url'), PLAYLIST);
  await next();
  fire(q('.wiz-back'), 'click');
  await settle();
  assert.deepEqual(calls.map((c) => c.url).filter((u) => u !== '/me' && u !== '/genres/vocabulary'), ['/albums/youtube/preview']);
  D().close();
});
