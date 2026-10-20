import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { draftStore, mountDrafts } = await import('./drafts.js');

const vid = (n) => `vid${String(n).padStart(8, '0')}`;
const PL = 'https://www.youtube.com/playlist?list=PL1';
const draft = (id, extra = {}) => ({ id, text: '', url: '', source: 'youtube', title: id, mainArtists: [], featuredArtists: [], withArtists: [], version: null, year: null, duration: null, thumbnail: null, state: 'new', inLibrary: false, createdAt: '2026-10-21T10:00:00Z', ...extra });
const playlist = (n) => ({
  playlist_id: 'PL1', title: 'Mix', channel: 'Chan', count: n, truncated: false, skipped: 0,
  entries: Array.from({ length: n }, (_, i) => ({ id: vid(i), title: `Band - Song ${i} (Official Video)`, channel: 'Band - Topic', duration: 200, url: `https://www.youtube.com/watch?v=${vid(i)}`, available: true })),
});

async function mount({ list = playlist(25), status = 200, drafts = [], songs = [], onPost = null } = {}) {
  draftStore.reset();
  store.songs = songs;
  const posts = [];
  const calls = stubFetch(async (url, o) => {
    const method = o.method || 'GET';
    if (url.startsWith('/youtube/playlist')) return status === 200 ? { body: list } : { status, body: { error: 'playlist_unavailable', detail: 'x' } };
    if (method === 'GET' && url === '/drafts') return { body: { drafts, counts: { total: drafts.length }, limit: 500 } };
    if (method === 'POST' && url === '/drafts') {
      const lines = JSON.parse(o.body).lines;
      posts.push(lines);
      onPost?.(posts.length);
      const created = lines.map((l, i) => draft(`n${posts.length}_${i}`, { text: l }));
      return { body: { created, updated: [], counts: { created: lines.length, duplicates: 0, overCap: 0, unfetched: 0, rateLimited: false } } };
    }
    return { body: {} };
  });
  const host = document.createElement('div');
  document.body.append(host);
  mountDrafts(host);
  await flush();
  await flush();
  const paste = async (text) => {
    host.querySelector('textarea').value = text;
    host.querySelector('form.drafts-paste').dispatchEvent(makeEvent('submit'));
    for (let i = 0; i < 12; i += 1) await flush();
  };
  return { host, calls, posts, paste, msg: () => host.querySelector('.drafts-msg').textContent };
}

test('a pasted playlist link is resolved once and added in chunks of 10, saving per chunk', async () => {
  const v = await mount();
  await v.paste(PL);
  const resolve = v.calls.filter((c) => c.url.startsWith('/youtube/playlist'));
  assert.equal(resolve.length, 1);
  assert.equal(resolve[0].url, `/youtube/playlist?url=${encodeURIComponent(PL)}`);
  assert.deepEqual(v.posts.map((p) => p.length), [10, 10, 5]);
  assert.equal(v.posts[0][0], `Band - Song 0 https://www.youtube.com/watch?v=${vid(0)}`);
  assert.equal(v.msg(), 'Added 25.');
  assert.equal(v.host.querySelector('textarea').value, '');
  assert.equal(v.host.querySelector('.drafts-import').hidden, true);
});

test('videos already in Drafts or the Library are skipped and counted, unavailable ones too', async () => {
  const list = playlist(6);
  list.entries[5].available = false;
  const v = await mount({ list, drafts: [draft('d0', { url: `https://www.youtube.com/watch?v=${vid(0)}` })], songs: [{ id: vid(1), title: 'x' }] });
  await v.paste(PL);
  assert.equal(v.posts.flat().length, 3);
  assert.equal(v.msg(), 'Added 3, skipped 2 already in your Drafts or Library, 1 unavailable.');
});

test('a private playlist shows the friendly message and keeps the pasted text', async () => {
  const v = await mount({ status: 422 });
  await v.paste(PL);
  assert.equal(v.msg(), 'This playlist is private or not available.');
  assert.equal(v.posts.length, 0);
  assert.match(v.host.querySelector('textarea').value, /playlist\?list=PL1/);
});

test('a paste without a playlist link does not call the playlist route', async () => {
  const v = await mount();
  await v.paste('Artist - Title\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v.calls.filter((c) => c.url.startsWith('/youtube/playlist')).length, 0);
  assert.deepEqual(v.posts.map((p) => p.length), [2]);
});

test('Cancel stops after the current chunk and keeps what was added', async () => {
  let v;
  v = await mount({
    list: playlist(40),
    onPost: (n) => {
      if (n === 1) v.host.querySelector('.drafts-import').querySelectorAll('button').find((b) => /Cancel/.test(b.textContent)).click();
    },
  });
  await v.paste(PL);
  assert.equal(v.posts.length, 1);
  assert.match(v.msg(), /Cancelled after 10 of 40: the 10 added drafts are kept\./);
});
