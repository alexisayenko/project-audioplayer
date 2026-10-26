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
const SEARCH = fixture('yt-search.json');
const PLAYLIST = PREVIEW.playlist.url;
const UPDATE = !!process.env.UPDATE_WEB_FIXTURES;
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush(); };
const create = () => qa('button').find((b) => /^Create album/.test(b.textContent));

function server(preview) {
  return stubFetch((u) => {
    if (u === '/albums/youtube/preview') return ok(preview);
    if (u === '/albums/discogs-search') return ok(SEARCH);
    if (u === '/albums/youtube/commit') return ok({ album: { id: 'alb_1', title: 'Twisted' }, songs: [], linked: 0, unlinked: 0 }, 201);
    if (u === '/me') return ok({ owner: true });
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [] });
    return ok({});
  });
}

async function popup() {
  openAddAlbum();
  q('.well input').value = PLAYLIST;
  fire(q('.well'), 'submit');
  await settle();
}

function sentBody(calls) {
  return JSON.parse(calls.find((c) => c.url === '/albums/youtube/commit').opts.body);
}

function checkFixture(name, data) {
  const path = new URL(`./fixtures/${name}`, import.meta.url);
  if (UPDATE) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  assert.deepEqual(data, fixture(name), `${name} differs from the recorded request; rerun with UPDATE_WEB_FIXTURES=1 and the server contract test`);
}

test('the real preview response renders the candidate row, the checked tracks and the Discogs match labels', async () => {
  server(PREVIEW);
  await popup();
  const cand = PREVIEW.candidates[0];
  assert.match(q('.album-cand-title').textContent, /Hallucinogen - Twisted/);
  assert.match(q('.album-best').textContent, /Best match/);
  assert.match(q('.album-cand-sub').textContent, /1995/);
  assert.match(q('.album-cand-sub').textContent, new RegExp(`${cand.trackCount} tracks`));
  assert.match(q('.album-cand-meta').textContent, /CD, Album/);
  assert.match(q('.album-cand-meta').textContent, /Dragonfly Records \(DRAGON 1\)/);
  assert.match(q('.album-cand-meta').textContent, /UK/);
  assert.equal(q('.album-guess').textContent, 'Looks like: Hallucinogen - Twisted · 1995');
  const rows = qa('li.album-yt-track');
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), [...Array(9).fill(true), false, false]);
  assert.equal(q('.album-yt-count').textContent, '9 of 11 selected');
  const labels = rows.map((r) => r.querySelector('.album-match').textContent);
  PREVIEW.tracks.forEach((t, i) => {
    const no = cand.matches[String(t.position)];
    assert.equal(labels[i], no == null ? 'no match' : `→ ${no}. ${cand.tracks.find((x) => x.no === no).title}`);
  });
  assert.equal(labels[0], '→ 1. LSD');
  assert.equal(labels[10], 'no match');
});

test('Create sends a body of the shape the server takes (recorded and replayed by the server contract test)', async () => {
  const calls = server(PREVIEW);
  await popup();
  fire(create(), 'click');
  await settle();
  const sent = sentBody(calls);
  assert.deepEqual(Object.keys(sent).sort(), ['candidate', 'fallback', 'mapping', 'playlistUrl', 'selected']);
  assert.equal(sent.playlistUrl, PLAYLIST);
  assert.deepEqual(sent.selected.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const s of sent.selected) {
    const t = PREVIEW.tracks.find((x) => x.position === s.position);
    assert.deepEqual(s, { position: t.position, videoId: t.videoId, title: t.title, durationS: t.durationS });
  }
  assert.deepEqual(sent.mapping, Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), n])));
  assert.equal(sent.candidate.discogsId, 77001);
  assert.equal('source' in sent.candidate || typeof sent.candidate.discogsId === 'number', true);
  assert.equal(sent.candidate.tracks.length, 9);
  assert.equal(sent.candidate.links.discogs, 'https://www.discogs.com/release/77001');
  assert.equal(sent.candidate.links.youtube, PLAYLIST);
  assert.deepEqual(sent.fallback, { title: 'Twisted', artist: 'Hallucinogen', year: 1995 });
  checkFixture('yt-commit-request.json', sent);
});

test('without candidates the body carries no candidate and the fallback title', async () => {
  const calls = server({ ...PREVIEW, candidates: [], searchError: 'discogs_unavailable' });
  await popup();
  assert.match(q('.album-picker').textContent, /Discogs is not available/);
  fire(create(), 'click');
  await settle();
  const sent = sentBody(calls);
  assert.equal(sent.candidate, null);
  assert.deepEqual(sent.mapping, {});
  assert.equal(sent.selected.length, 11);
  checkFixture('yt-commit-fallback-request.json', sent);
});

test('Search again feeds the real search response into the list', async () => {
  const calls = server(PREVIEW);
  await popup();
  fire(q('.album-search'), 'submit');
  await settle();
  const req = JSON.parse(calls.find((c) => c.url === '/albums/discogs-search').opts.body);
  assert.deepEqual(Object.keys(req).sort(), ['album', 'artist', 'durationsS', 'playlistTracks', 'trackCount']);
  assert.deepEqual(req.playlistTracks[0], { position: 1, title: 'LSD', durationS: 450 });
  assert.equal(qa('li.album-yt-track').filter((r) => r.querySelector('input').checked).length, Object.values(SEARCH.candidates[0].matches).filter((n) => n != null).length);
});

test('Cancel sends nothing beyond the preview', async () => {
  const calls = server(PREVIEW);
  await popup();
  fire(qa('button').find((b) => b.textContent === 'Cancel'), 'click');
  await settle();
  assert.deepEqual(calls.map((c) => c.url).filter((u) => u !== '/me'), ['/albums/youtube/preview']);
});
