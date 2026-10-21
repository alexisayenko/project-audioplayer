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
let graphReply = () => ({ body: { nodes: [], edges: [] } });
const graphCalls = stubFetch((url) => graphReply(url));
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

function mount(loaded = true, songs = SONGS) {
  store.songs = songs;
  store.tags = [];
  store.loaded = loaded;
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderStats(root);
  return { root, cleanup };
}

const buttons = (root, label) => root.querySelectorAll('button').filter((b) => b.textContent.startsWith(label));

test('renders title, count, skipped note, canvas label and legend', async () => {
  localStorage.setItem('stats.color', 'decade');
  const { root, cleanup } = mount();
  await flush();
  assert.equal(root.querySelector('h1').textContent, 'Statistics');
  assert.equal(root.querySelector('.st-count').textContent, '3 of 5 songs plotted');
  assert.equal(root.querySelector('.st-note').textContent, '2 songs without year or BPM are not shown');
  assert.match(root.querySelector('canvas.st-top').getAttribute('aria-label'), /^Scatter plot of 3 songs/);
  const keys = root.querySelectorAll('.st-key');
  assert.deepEqual(keys.map((k) => k.textContent), ['1990s1', '2000s1', '2010s1']);
  keys[0].click();
  assert.ok(root.querySelectorAll('.st-key')[0].classList.contains('off'));
  assert.equal(root.querySelectorAll('.st-key')[0].getAttribute('aria-pressed'), 'false');
  cleanup();
  localStorage.removeItem('stats.color');
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
  assert.ok(panel.querySelector('[data-act="play"]').classList.contains('key'), 'WEB-099: Play is a dock key');
  assert.ok(panel.querySelector('[data-act="add"]').classList.contains('round'), 'WEB-099: Add to playlist is a round icon');
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

const GENRE_GRAPH = {
  nodes: [
    { id: 'q1', label: 'House', family: 'Electronic', tags: ['house'], count: 2 },
    { id: 'q2', label: 'Rock', family: 'Rock', tags: ['rock'], count: 1 },
  ],
  edges: [],
  ontology: true,
};
const GENRE_SONGS = [
  { id: 'a', title: 'Alpha', artist: 'Zed', year: 1995, bpm: 120, file: 'a.mp3', tags: ['genre:house'] },
  { id: 'b', title: 'Beta', artist: 'Yan', year: 2005, bpm: 90, file: 'b.mp3', tags: ['genre:house', 'genre:rock'] },
  { id: 'c', title: 'Gamma', artist: 'Xi', year: 2015, bpm: 170, file: 'c.mp3', tags: ['genre:rock'] },
  { id: 'd', title: 'Delta', artist: 'Wu', year: 2010, bpm: 100, file: 'd.mp3', tags: [] },
];
const legendText = (root) => root.querySelectorAll('.st-key').map((k) => k.textContent);

test('the default colouring is the genre family, a saved choice wins', async () => {
  localStorage.removeItem('stats.color');
  graphReply = () => ({ body: GENRE_GRAPH });
  const first = mount(true, GENRE_SONGS);
  await flush();
  assert.deepEqual(first.root.querySelectorAll('option').map((o) => o.value), ['family', 'decade', 'audio', 'none']);
  assert.deepEqual(legendText(first.root), ['Electronic2', 'Rock1', 'Other1']);
  assert.equal(first.root.querySelectorAll('.st-sw').length, 3);
  first.cleanup();
  localStorage.setItem('stats.color', 'audio');
  const saved = mount(true, GENRE_SONGS);
  await flush();
  assert.deepEqual(legendText(saved.root), ['Audio on server4']);
  saved.cleanup();
  localStorage.setItem('stats.color', 'bogus');
  const bad = mount(true, GENRE_SONGS);
  await flush();
  assert.deepEqual(legendText(bad.root), ['Electronic2', 'Rock1', 'Other1']);
  bad.cleanup();
  localStorage.removeItem('stats.color');
});

test('family legend toggles groups and the table gets a Family column', async () => {
  localStorage.removeItem('stats.color');
  graphReply = () => ({ body: GENRE_GRAPH });
  const { root, cleanup } = mount(true, GENRE_SONGS);
  await flush();
  root.querySelectorAll('.st-key')[0].click();
  assert.ok(root.querySelectorAll('.st-key')[0].classList.contains('off'));
  buttons(root, 'View as table')[0].click();
  assert.deepEqual(root.querySelectorAll('tbody tr').map((r) => r.getAttribute('data-id')), ['d', 'c']);
  assert.equal(root.querySelectorAll('tbody tr')[1].querySelectorAll('td').pop().textContent, 'Rock');
  assert.ok(buttons(root, 'Family').length);
  cleanup();
});

test('pending graph: neutral dots and a resolving note, then recolour as polls arrive', async () => {
  localStorage.removeItem('stats.color');
  const timers = [];
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 5000 ? timers.push(fn) : realSet(fn, ms, ...a));
  graphReply = () => ({ body: { nodes: [], edges: [], pending: true } });
  const { root, cleanup } = mount(true, GENRE_SONGS);
  await flush();
  assert.equal(root.querySelectorAll('.st-key').length, 0);
  assert.equal(root.querySelector('.st-legend').textContent, 'Resolving genre families...');
  assert.equal(timers.length, 1);
  graphReply = () => ({ body: { ...GENRE_GRAPH, pending: true } });
  timers.shift()();
  await flush();
  assert.deepEqual(legendText(root), ['Electronic2', 'Rock1', 'Other1']);
  assert.equal(timers.length, 1);
  assert.equal(root.querySelector('.st-count').textContent, '4 of 4 songs plotted');
  graphReply = () => ({ body: GENRE_GRAPH });
  timers.shift()();
  await flush();
  assert.equal(timers.length, 0);
  assert.deepEqual(legendText(root), ['Electronic2', 'Rock1', 'Other1']);
  globalThis.setTimeout = realSet;
  cleanup();
});

test('an unavailable graph falls back to Other once and is not refetched', async () => {
  localStorage.removeItem('stats.color');
  graphReply = () => ({ status: 500, body: {} });
  const before = graphCalls.length;
  const { root, cleanup } = mount(true, GENRE_SONGS);
  await flush();
  assert.deepEqual(legendText(root), ['Other4']);
  const select = root.querySelector('select');
  select.value = 'decade';
  fire(select, 'change', { target: select });
  select.value = 'family';
  fire(select, 'change', { target: select });
  await flush();
  assert.equal(graphCalls.length - before, 1);
  cleanup();
  localStorage.removeItem('stats.color');
});

test('right-drag pans, suppresses the context menu, draws no band and opens no card', async () => {
  localStorage.setItem('stats.color', 'none');
  const { root, cleanup } = mount();
  await flush();
  const top = root.querySelector('canvas.st-top');
  const reset = buttons(root, 'Reset')[0];
  assert.equal(fire(top, 'contextmenu', { clientX: 100, clientY: 100 }), false);
  fire(top, 'pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 1 });
  fire(top, 'pointermove', { clientX: 300, clientY: 250, pointerId: 1 });
  assert.equal(top.style.cursor, 'grabbing');
  assert.equal(reset.hidden, false);
  fire(top, 'pointerup', { clientX: 300, clientY: 250, button: 2, pointerId: 1 });
  assert.equal(root.querySelector('.st-panel').hidden, true);
  assert.equal(top.style.cursor, 'crosshair');
  reset.click();
  assert.equal(reset.hidden, true);
  cleanup();
  localStorage.removeItem('stats.color');
});

test('shift-drag and middle-drag pan, plain left-drag still selects', async () => {
  localStorage.setItem('stats.color', 'none');
  const { root, cleanup } = mount();
  await flush();
  const top = root.querySelector('canvas.st-top');
  const reset = buttons(root, 'Reset')[0];
  for (const init of [{ button: 0, shiftKey: true }, { button: 1 }]) {
    fire(top, 'pointerdown', { clientX: 400, clientY: 300, pointerId: 1, ...init });
    fire(top, 'pointermove', { clientX: 350, clientY: 280, pointerId: 1 });
    fire(top, 'pointerup', { clientX: 350, clientY: 280, pointerId: 1 });
    assert.equal(reset.hidden, false);
    reset.click();
  }
  fire(top, 'pointerdown', { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
  fire(top, 'pointermove', { clientX: 790, clientY: 590, pointerId: 1 });
  fire(top, 'pointerup', { clientX: 790, clientY: 590, pointerId: 1 });
  assert.equal(root.querySelector('.st-panel').hidden, false);
  assert.equal(reset.hidden, true);
  cleanup();
  localStorage.removeItem('stats.color');
});

test('the Center button and the c key centre the view without a Reset-only state', async () => {
  localStorage.setItem('stats.color', 'none');
  const { root, cleanup } = mount();
  await flush();
  const top = root.querySelector('canvas.st-top');
  const reset = buttons(root, 'Reset')[0];
  const center = root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Center chart');
  assert.ok(center);
  fire(top, 'pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 1 });
  fire(top, 'pointermove', { clientX: 300, clientY: 250, pointerId: 1 });
  fire(top, 'pointerup', { clientX: 300, clientY: 250, button: 2, pointerId: 1 });
  assert.equal(reset.hidden, false);
  center.click();
  fire(top, 'keydown', { key: 'c' });
  assert.equal(reset.hidden, false);
  reset.click();
  assert.equal(reset.hidden, true);
  fire(top, 'keydown', { key: 'c' });
  assert.equal(reset.hidden, true);
  cleanup();
  localStorage.removeItem('stats.color');
});

test('the panel has a chevron that collapses everything below the title row and remembers it', async () => {
  window.innerWidth = 1200;
  localStorage.removeItem('ap2.panel.stats');
  const { root, cleanup } = mount();
  await flush();
  const chev = root.querySelector('.st-bar .cl-btn');
  assert.equal(chev.getAttribute('aria-expanded'), 'true');
  assert.equal(chev.getAttribute('aria-controls'), 'st-bar-body');
  assert.ok(root.querySelector('#st-bar-body .st-tools'));
  assert.ok(root.querySelector('.st-row .st-count'));
  chev.click();
  assert.equal(chev.getAttribute('aria-label'), 'Expand panel');
  assert.ok(root.querySelector('.st-bar .cl').classList.contains('collapsed'));
  assert.equal(localStorage.getItem('ap2.panel.stats'), '1');
  cleanup();
  const again = mount();
  await flush();
  assert.equal(again.root.querySelector('.st-bar .cl-btn').getAttribute('aria-expanded'), 'false');
  again.cleanup();
  localStorage.removeItem('ap2.panel.stats');
});

test('Statistics shows one page title inside the standard page head and no small bar title', async () => {
  const { root, cleanup } = mount();
  await flush();
  const h1s = root.querySelectorAll('h1');
  assert.equal(h1s.length, 1);
  assert.equal(h1s[0].textContent, 'Statistics');
  assert.ok(h1s[0].className.includes('t-display'));
  const head = h1s[0].parentElement;
  assert.equal(head.tagName.toLowerCase(), 'header');
  assert.ok(head.className.includes('page-head'));
  assert.equal(head.querySelector('.t-eyebrow').textContent, 'ELECTROPHONE');
  assert.equal(root.querySelector('.st-title'), null);
  assert.equal(root.querySelector('.st').children[0], head);
  assert.equal(root.querySelector('.st .st-bar').closest('.st-work').parentElement, root.querySelector('.st'));
  cleanup();
});
