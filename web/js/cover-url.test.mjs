import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const { store } = await import('./store.js');
const { api } = await import('./api.js');
const { thumbSize, coverUrl, thumbImg, ROW_PX, QUEUE_PX, MINI_PX, SMALL_PX } = await import('./cover-url.js');
const { songRow } = await import('./library-rows.js');
const { queueRow, setCover } = await import('./player-ui.js');

const song = { id: 'abcdefghijk', title: 'T', artist: 'A', file: 'x.m4a', tags: [], cover: 'covers/abcdefghijk.jpg', cover_v: 'f00d' };

test('thumbSize picks 96 for small, 192 for the common 60 px row and 320 for large', () => {
  assert.equal(thumbSize(40, 2), 96);
  assert.equal(thumbSize(48, 2), 96);
  assert.equal(thumbSize(60, 1), 96);
  assert.equal(thumbSize(60, 2), 192);
  assert.equal(thumbSize(60, 3), 192);
  assert.equal(thumbSize(66, 3), 192);
  assert.equal(thumbSize(84, 2), 192);
  assert.equal(thumbSize(96, 2), 192);
  assert.equal(thumbSize(160, 2), 320);
  assert.equal(thumbSize(500, 3), 320);
});

test('thumbSize reads the device pixel ratio when none is given', () => {
  const was = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 3;
  assert.equal(thumbSize(60), 192);
  globalThis.devicePixelRatio = 1;
  assert.equal(thumbSize(60), 96);
  globalThis.devicePixelRatio = was;
});

test('coverUrl keeps the cover version query and adds the size', () => {
  assert.equal(coverUrl(song, 60, 2), '/covers/abcdefghijk?v=f00d&size=192');
  assert.equal(coverUrl({ id: 'abcdefghijk' }, 60, 2), '/covers/abcdefghijk?size=192');
  assert.equal(api.coverUrl('abc', 'f00d'), '/covers/abc?v=f00d');
  api.bumpCovers();
  assert.match(coverUrl(song, 60, 2), /^\/covers\/abcdefghijk\?v=f00d&r=\d+&size=192$/);
});

test('thumbImg is lazy, async, sized and falls back to the placeholder on error', () => {
  const img = thumbImg(song, QUEUE_PX);
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.equal(img.getAttribute('decoding'), 'async');
  assert.equal(img.getAttribute('fetchpriority'), 'low');
  assert.equal(img.getAttribute('width'), String(QUEUE_PX));
  assert.equal(img.getAttribute('height'), String(QUEUE_PX));
  assert.match(img.getAttribute('src'), /^\/covers\/abcdefghijk\?v=f00d.*&size=\d+$/);
  img.dispatchEvent(new globalThis.Event('error'));
  assert.equal(img.getAttribute('src'), null);
  assert.equal(thumbImg({ id: 'abcdefghijk' }, SMALL_PX).getAttribute('src'), null);
});

test('library rows and queue rows request thumbnails, not the original', () => {
  const row = songRow(song, null, null);
  assert.match(row.querySelector('img.cover').getAttribute('src'), /size=(96|192)$/);
  assert.equal(row.querySelector('img.cover').getAttribute('width'), String(ROW_PX));
  store.songs = [song];
  store.loaded = true;
  const noop = () => {};
  const q = queueRow({ id: song.id }, 0, { count: 1, index: 0, move: noop, removeAt: noop, playAt: noop });
  assert.match(q.querySelector('img.cover').getAttribute('src'), /size=(96|192)$/);
  assert.equal(q.querySelector('img.cover').getAttribute('loading'), 'lazy');
});

test('mini-player cover uses a thumbnail while Now playing keeps the original', () => {
  const mini = document.createElement('img');
  const full = document.createElement('img');
  setCover(mini, song, MINI_PX);
  setCover(full, song);
  assert.match(mini.getAttribute('src'), /size=\d+$/);
  assert.doesNotMatch(full.getAttribute('src'), /size=/);
  setCover(mini, { id: 'abcdefghijk' }, MINI_PX);
  assert.equal(mini.getAttribute('src'), null);
});

test('a queue re-render keeps the loaded img elements, so the browser is not asked for them again', async () => {
  const { keepCovers } = await import('./row-cover.js');
  const other = { ...song, id: 'bcdefghijkl', cover_v: 'beef' };
  store.songs = [song, other];
  store.loaded = true;
  const noop = () => {};
  const ctx = { count: 3, index: 0, move: noop, removeAt: noop, playAt: noop };
  const items = [{ id: song.id }, { id: other.id }, { id: song.id }];
  const build = () => items.map((it, i) => queueRow(it, i, ctx));
  const before = build();
  const imgs = before.map((r) => r.querySelector('img.cover'));
  const after = build();
  keepCovers(before, after);
  const now = after.map((r) => r.querySelector('img.cover'));
  assert.equal(now[1], imgs[1]);
  assert.equal(now.filter((n) => imgs.includes(n)).length, 2);
  assert.equal(new Set(now).size, 3);
  assert.equal(now[2].getAttribute('src'), imgs[2].getAttribute('src'));
});

test('a changed cover version is not kept: the row gets the new url', async () => {
  const { keepCovers } = await import('./row-cover.js');
  store.songs = [song];
  const noop = () => {};
  const ctx = { count: 1, index: 0, move: noop, removeAt: noop, playAt: noop };
  const before = [queueRow({ id: song.id }, 0, ctx)];
  store.songs = [{ ...song, cover_v: 'new1' }];
  const after = [queueRow({ id: song.id }, 0, ctx)];
  keepCovers(before, after);
  assert.match(after[0].querySelector('img.cover').getAttribute('src'), /v=new1/);
});
