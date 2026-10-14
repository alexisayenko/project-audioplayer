import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire, DomElement } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
Object.assign(DomElement.prototype, {
  getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  setPointerCapture() {},
  releasePointerCapture() {},
});
Object.defineProperty(DomElement.prototype, 'clientWidth', { get: () => 800, configurable: true });
Object.defineProperty(DomElement.prototype, 'clientHeight', { get: () => 600, configurable: true });
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
stubFetch(() => ({ body: { nodes: [], edges: [] } }));
const { store } = await import('./store.js');
const { player } = await import('./player.js');
const { renderStats } = await import('./stats.js');

const SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', year: 1995, bpm: 120, file: 'a.mp3', tags: [] },
  { id: 'b', title: 'Beta', artist: 'Yan', year: 2005, bpm: 90, file: null, audio_state: 'none', tags: [] },
  { id: 'c', title: 'Gamma', artist: 'Xi', year: 2015, bpm: 170, file: 'c.mp3', tags: [] },
  { id: 'd', title: 'NoBpm', artist: 'Wu', year: 2000, file: 'd.mp3', tags: [] },
  { id: 'e', title: 'NoYear', artist: 'Vu', bpm: 100, file: 'e.mp3', tags: [] },
];

function mount(loaded = true) {
  store.songs = SONGS;
  store.tags = [];
  store.loaded = loaded;
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderStats(root);
  return { root, cleanup };
}

const buttons = (root, label) => root.querySelectorAll('button').filter((b) => b.textContent.startsWith(label));

test('renders title, count, skipped note, canvas label and legend', async () => {
  const { root, cleanup } = mount();
  await flush();
  assert.equal(root.querySelector('h1').textContent, 'Song stats');
  assert.equal(root.querySelector('.st-count').textContent, '3 of 5 songs plotted');
  assert.equal(root.querySelector('.st-note').textContent, '2 songs without year or BPM are not shown');
  assert.match(root.querySelector('canvas.st-top').getAttribute('aria-label'), /^Scatter plot of 3 songs/);
  const keys = root.querySelectorAll('.st-key');
  assert.deepEqual(keys.map((k) => k.textContent), ['1990s1', '2000s1', '2010s1']);
  keys[0].click();
  assert.ok(root.querySelectorAll('.st-key')[0].classList.contains('off'));
  assert.equal(root.querySelectorAll('.st-key')[0].getAttribute('aria-pressed'), 'false');
  cleanup();
});

test('shows the empty and loading states', async () => {
  store.songs = [{ id: 'x', title: 'X', year: null, bpm: null }];
  store.loaded = true;
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderStats(root);
  await flush();
  assert.equal(root.querySelector('.st-empty').hidden, false);
  assert.equal(root.querySelector('.st-empty').textContent, 'Songs need a year and a BPM to appear here');
  cleanup();
  const loading = mount(false);
  await flush();
  assert.equal(loading.root.querySelector('.st-empty').textContent, 'Loading songs...');
  loading.cleanup();
});

test('colour mode is remembered and none hides the legend', async () => {
  const { root, cleanup } = mount();
  await flush();
  const select = root.querySelector('select');
  select.value = 'audio';
  fire(select, 'change', { target: select });
  await flush();
  assert.equal(localStorage.getItem('stats.color'), 'audio');
  assert.deepEqual(root.querySelectorAll('.st-key').map((k) => k.textContent), ['Audio on server2', 'No audio1']);
  select.value = 'none';
  fire(select, 'change', { target: select });
  await flush();
  assert.equal(root.querySelector('.st-legend').hidden, true);
  cleanup();
  const again = mount();
  assert.equal(again.root.querySelector('.st-legend').hidden, true);
  again.cleanup();
  localStorage.removeItem('stats.color');
});

test('table view lists plotted songs and sorts by column', async () => {
  const { root, cleanup } = mount();
  await flush();
  buttons(root, 'View as table')[0].click();
  const rows = () => root.querySelectorAll('tbody tr').map((r) => r.getAttribute('data-id'));
  assert.deepEqual(rows(), ['a', 'b', 'c']);
  buttons(root, 'BPM')[0].click();
  assert.deepEqual(rows(), ['b', 'a', 'c']);
  buttons(root, 'BPM')[0].click();
  assert.deepEqual(rows(), ['c', 'a', 'b']);
  assert.equal(root.querySelector('table').querySelectorAll('th')[3].getAttribute('aria-sort'), 'descending');
  buttons(root, 'View as chart')[0].click();
  assert.equal(root.querySelector('.st-tablebox').hidden, true);
  cleanup();
});

test('rubber-band selection shows the panel and the buttons call the queue functions with the selected ids', async () => {
  const { root, cleanup } = mount();
  await flush();
  const top = root.querySelector('canvas.st-top');
  fire(top, 'pointerdown', { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
  fire(top, 'pointermove', { clientX: 790, clientY: 590, pointerId: 1 });
  fire(top, 'pointerup', { clientX: 790, clientY: 590, pointerId: 1 });
  const panel = root.querySelector('.st-panel');
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /^3 selected:/);
  assert.equal(panel.querySelector('[data-act="library"]').disabled, true);
  const calls = [];
  const orig = { add: player.addListed, play: player.playListed };
  player.addListed = (songs, tag) => { calls.push(['add', songs.map((s) => s.id), tag]); return { added: 3, already: 0, fetching: 0 }; };
  player.playListed = (songs, tags) => { calls.push(['play', songs.map((s) => s.id), tags]); return { count: 3, skipped: 0, replaced: false, fetching: 0 }; };
  panel.querySelector('[data-act="add"]').click();
  panel.querySelector('[data-act="play"]').click();
  Object.assign(player, { addListed: orig.add, playListed: orig.play });
  assert.deepEqual(calls, [['add', ['a', 'b', 'c'], ''], ['play', ['a', 'b', 'c'], []]]);
  panel.querySelector('[data-act="clear"]').click();
  assert.equal(root.querySelector('.st-panel').hidden, true);
  cleanup();
});

test('wheel zoom shows Reset and Reset restores the view; keyboard moves a live focus', async () => {
  const { root, cleanup } = mount();
  await flush();
  const top = root.querySelector('canvas.st-top');
  const reset = buttons(root, 'Reset')[0];
  assert.equal(reset.hidden, true);
  fire(top, 'wheel', { clientX: 400, clientY: 300, deltaY: -200 });
  assert.equal(reset.hidden, false);
  reset.click();
  assert.equal(reset.hidden, true);
  await flush();
  fire(top, 'keydown', { key: 'ArrowRight' });
  assert.match(root.querySelector('[aria-live]').textContent, /Alpha, Zed, 1995, 120 BPM/);
  fire(top, 'keydown', { key: 'ArrowRight' });
  assert.match(root.querySelector('[aria-live]').textContent, /Beta/);
  cleanup();
});
