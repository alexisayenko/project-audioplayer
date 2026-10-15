import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire, DomElement } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
Object.assign(DomElement.prototype, {
  getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, bottom: 600 }),
  setPointerCapture() {},
  releasePointerCapture() {},
});
Object.defineProperty(DomElement.prototype, 'clientWidth', { get: () => 800, configurable: true });
Object.defineProperty(DomElement.prototype, 'clientHeight', { get: () => 600, configurable: true });
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
const GRAPH = {
  nodes: [
    { id: 'Q1', label: 'House', tags: ['house'], count: 3, family: 'dance', parents: [] },
    { id: 'Q2', label: 'Trance', tags: ['trance'], count: 2, family: 'dance', parents: [] },
  ],
  edges: [],
};
stubFetch(() => ({ body: GRAPH }));
const { store } = await import('./store.js');
const { player } = await import('./player.js');
const { renderGenres } = await import('./genres.js');

const song = { id: 's1', title: 'Alpha', remixer: 'Bob', artist: 'Zed', tags: ['genre:house', 'genre:zouk', 'decade:90s'] };
let current = song;
Object.defineProperty(player, 'current', { get: () => current, configurable: true });

async function mount() {
  store.songs = [song];
  store.tags = [];
  store.loaded = true;
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenres(root);
  await flush();
  return { root, cleanup };
}
const btn = (root, label) => root.querySelectorAll('button').find((b) => b.textContent.includes(label));

test('Now playing lists song genres, muted when not in the map, and Esc closes', async () => {
  const { root, cleanup } = await mount();
  const now = btn(root, 'Now playing');
  assert.equal(now.disabled, false);
  assert.equal(now.getAttribute('aria-expanded'), 'false');
  fire(now, 'click');
  assert.equal(now.getAttribute('aria-expanded'), 'true');
  const pop = root.querySelector('#gm-now');
  assert.equal(pop.hidden, false);
  assert.match(pop.textContent, /Alpha/);
  assert.match(pop.textContent, /\(Bob\)/);
  const chips = pop.querySelectorAll('.gm-chip');
  assert.equal(chips.length, 2);
  assert.equal(chips[1].getAttribute('title'), 'Not in the map yet');
  assert.equal(pop.textContent.includes('90s'), false);
  fire(root.querySelector('.gm'), 'keydown', { key: 'Escape' });
  assert.equal(now.getAttribute('aria-expanded'), 'false');
  assert.equal(pop.hidden, true);
  cleanup();
});

test('Now playing is disabled with nothing playing or without genres', async () => {
  current = null;
  const a = await mount();
  assert.equal(btn(a.root, 'Now playing').disabled, true);
  assert.equal(btn(a.root, 'Now playing').getAttribute('title'), 'Nothing playing');
  a.cleanup();
  current = { ...song, tags: ['decade:90s'] };
  const b = await mount();
  assert.equal(btn(b.root, 'Now playing').getAttribute('title'), 'No genres for this song');
  assert.equal(btn(b.root, 'Now playing').disabled, true);
  b.cleanup();
  current = song;
});

test('toggling the outline leaves the canvas size alone', async () => {
  const { root, cleanup } = await mount();
  const canvas = root.querySelector('canvas');
  const before = `${canvas.width}x${canvas.height}`;
  const out = btn(root, 'Outline') || root.querySelector('.gm-x');
  fire(out, 'click');
  fire(out, 'click');
  assert.equal(`${canvas.width}x${canvas.height}`, before);
  cleanup();
});

test('Now playing follows song changes while mounted and works for a paused or restored song', async () => {
  current = null;
  const a = await mount();
  const b0 = btn(a.root, 'Now playing');
  assert.equal(b0.disabled, true);
  current = { ...song, paused: true };
  store.set ? store.set({}) : store.listeners.forEach((fn) => fn());
  assert.equal(b0.disabled, false);
  current = null;
  store.listeners.forEach((fn) => fn());
  assert.equal(b0.disabled, true);
  a.cleanup();
  current = song;
});

test('hovering an outline row or a chip only hovers, never selects', async () => {
  const { root, cleanup } = await mount();
  const rows = () => root.querySelectorAll('.gm-row').filter((r) => !r.className.includes('fam')).map((r) => r.querySelector('.gm-lbl'));
  if (!rows().length) fire(root.querySelector('.gm-tw'), 'click');
  const row = rows()[0];
  assert.ok(row, root.querySelector('.gm-tree').textContent);
  fire(row, 'pointerenter');
  fire(row, 'pointerleave');
  assert.equal(root.querySelector('.gm-panel').hidden, true);
  cleanup();
});

test('Now playing presses and selects the song genres; Esc and a second press release it', async () => {
  const { root, cleanup } = await mount();
  const now = btn(root, 'Now playing');
  assert.equal(now.getAttribute('aria-pressed'), 'false');
  fire(now, 'click');
  assert.equal(now.getAttribute('aria-pressed'), 'true');
  fire(root.querySelector('.gm'), 'keydown', { key: 'Escape' });
  assert.equal(now.getAttribute('aria-pressed'), 'false');
  fire(now, 'click');
  fire(now, 'click');
  assert.equal(now.getAttribute('aria-pressed'), 'false');
  assert.equal(now.getAttribute('aria-expanded'), 'false');
  cleanup();
});

test('the toolbar and the Now playing card have their own chevrons with saved state', async () => {
  window.innerWidth = 1200;
  localStorage.removeItem('ap2.panel.genres');
  localStorage.removeItem('ap2.panel.genreInfo');
  const { root, cleanup } = await mount();
  const bar = root.querySelector('.gm-bar-row .cl-btn');
  assert.equal(bar.getAttribute('aria-expanded'), 'true');
  assert.equal(bar.getAttribute('aria-controls'), 'gm-bar-body');
  assert.ok(root.querySelector('#gm-bar-body .gm-find'));
  bar.click();
  assert.equal(localStorage.getItem('ap2.panel.genres'), '1');
  assert.ok(btn(root, 'Now playing'));
  fire(btn(root, 'Now playing'), 'click');
  const info = root.querySelector('#gm-now .cl-btn');
  assert.equal(info.getAttribute('aria-controls'), 'gm-now-body');
  assert.equal(info.getAttribute('aria-expanded'), 'true');
  info.click();
  assert.equal(info.getAttribute('aria-label'), 'Expand panel');
  assert.equal(localStorage.getItem('ap2.panel.genreInfo'), '1');
  cleanup();
  localStorage.removeItem('ap2.panel.genres');
  localStorage.removeItem('ap2.panel.genreInfo');
});
