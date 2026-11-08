import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
globalThis.innerHeight = 800;
stubFetch(() => ({ body: {} }));

const watched = new Set();
let options = null;
let callback = null;
globalThis.IntersectionObserver = class {
  constructor(cb, opts) { if (opts?.rootMargin) { callback = cb; options = opts; } }
  observe(n) { watched.add(n); }
  unobserve(n) { watched.delete(n); }
};
const see = (img) => callback([{ target: img.parentElement || img, isIntersecting: true }]);
const leave = (img) => callback([{ target: img.parentElement || img, isIntersecting: false }]);
const tick = () => Promise.resolve();

const { thumbImg, revealCover } = await import('./cover-url.js');
const { resetCoverLoader, coverLoadState } = await import('./cover-loader.js');
const { songRow } = await import('./library-rows.js');
const { keepCovers } = await import('./row-cover.js');
const { prioritizeCovers } = await import('./library.js');

const songs = Array.from({ length: 786 }, (_, i) => ({ id: `id${String(i).padStart(9, '0')}`, title: `T${i}`, artist: 'A', file: 'x.m4a', tags: [], cover: 'c', cover_v: `v${i}` }));

test('rows of a long list get no src until they are within about 1.5 screens', async () => {
  resetCoverLoader();
  const rows = songs.map((s) => songRow(s, null, null));
  rows.forEach((r) => document.body.append(r));
  const imgs = rows.map((r) => r.querySelector('img.cover'));
  await tick();
  assert.equal(options.rootMargin, '1200px 0px');
  assert.equal(imgs.filter((i) => i.getAttribute('src')).length, 0);
  assert.equal(watched.size, 786);
  see(imgs[3]);
  assert.match(imgs[3].getAttribute('src'), /^\/covers\/id000000003\?v=v3&size=\d+$/);
  assert.equal(imgs.filter((i) => i.getAttribute('src')).length, 1);
  for (let i = 10; i < 20; i += 1) see(imgs[i]);
  assert.equal(imgs.filter((i) => i.getAttribute('src')).length, 3);
  assert.equal(coverLoadState().waiting, 8);
  leave(imgs[19]);
  leave(imgs[18]);
  assert.equal(coverLoadState().waiting, 6);
  imgs[3].dispatchEvent(new globalThis.Event('load'));
  assert.equal(imgs.filter((i) => i.getAttribute('src')).length, 4);
  assert.equal(imgs[19].getAttribute('src'), null);
  resetCoverLoader();
});

test('the first rows are revealed at once by prioritizeCovers', () => {
  resetCoverLoader();
  const rows = songs.slice(0, 20).map((s) => songRow(s, null, null));
  rows.forEach((r) => document.body.append(r));
  prioritizeCovers(rows, 12);
  assert.equal(rows.filter((r) => r.querySelector('img.cover').getAttribute('src')).length, 3);
  assert.equal(coverLoadState().waiting, 9);
  resetCoverLoader();
});

test('keepCovers moves an already loaded image to the repainted row and stops watching the new one', async () => {
  resetCoverLoader();
  const [old] = [songRow(songs[0], null, null)];
  document.body.append(old);
  revealCover(old.querySelector('img.cover'));
  const fresh = songRow(songs[0], null, null);
  const freshImg = fresh.querySelector('img.cover');
  await tick();
  assert.ok(watched.has(freshImg.parentElement));
  const kept = old.querySelector('img.cover');
  const host = fresh.querySelector('.row-cover');
  keepCovers([old], [fresh]);
  assert.ok(!watched.has(freshImg.parentElement));
  assert.equal(host.querySelector('img.cover'), kept);
});

test('a song without a cover is never watched', () => {
  const before = watched.size;
  const img = thumbImg({ id: 'abcdefghijk' }, 60, { defer: true });
  assert.equal(watched.size, before);
  assert.equal(img.getAttribute('src'), null);
});

test('in the queue the current song cover loads at once, the others wait for the loader', async () => {
  const { store } = await import('./store.js');
  const { queueRow } = await import('./player-ui.js');
  resetCoverLoader();
  store.songs = songs.slice(0, 3);
  store.loaded = true;
  const noop = () => {};
  const ctx = { count: 3, index: 1, move: noop, removeAt: noop, playAt: noop };
  const rows = [0, 1, 2].map((i) => queueRow({ id: songs[i].id }, i, ctx));
  rows.forEach((r) => document.body.append(r));
  const img = (i) => rows[i].querySelector('img.cover');
  assert.equal(img(0).getAttribute('src'), null);
  assert.match(img(1).getAttribute('src'), /size=\d+$/);
  assert.equal(img(2).getAttribute('src'), null);
  assert.equal(img(0).getAttribute('fetchpriority'), 'low');
  assert.equal(coverLoadState().loading, 0);
});
