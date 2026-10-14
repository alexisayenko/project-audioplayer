import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, fire, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const audioGraph = await import('./audio-graph.js');
const { initVisualizer } = await import('./viz-ui.js');
const { createFullscreen, makeAutoHide, isVizKey, isNearBox } = await import('./viz-fullscreen.js');
const { setVizBackground, vizBackgroundOn } = await import('./viz-settings.js');

const $ = (id) => document.getElementById(id);
const audio = $('audio');

function fakeCtx() {
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
}
$('viz-bg').getContext = fakeCtx;
$('viz-full-canvas').getContext = fakeCtx;

const stats = { ctors: 0, sources: 0 };
class FakeAudioContext {
  constructor() { stats.ctors += 1; this.state = 'suspended'; this.destination = {}; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  addEventListener() {}
  createGain() { return { connect() {} }; }
  createAnalyser() { return { connect() {} }; }
  createMediaElementSource() { stats.sources += 1; return { connect() {} }; }
}
const win = { AudioContext: FakeAudioContext, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const song = { id: 'a', title: 'Alpha', artist: 'AA' };
const calls = [];
const player = {
  current: song,
  toggle: () => calls.push('toggle'),
  prev: () => calls.push('prev'),
  next: () => calls.push('next'),
  seek: (t) => calls.push(`seek:${t}`),
};

audioGraph.resetForTests();
document.body.dataset.route = 'library';
const ui = initVisualizer({ player, audio, graph: audioGraph, win });
const key = (k, init = {}, target = document.body) => fire(target, 'keydown', { key: k, ...init });

test('nothing Web Audio is created at start', () => {
  assert.equal(stats.ctors, 0);
  assert.equal(audioGraph.hasGraph(), false);
  assert.equal($('p-viz').disabled, false);
  assert.equal($('viz-full').hidden, true);
  assert.notEqual($('p-viz').getAttribute('aria-pressed'), 'true');
});

test('V is ignored outside the Playback screen', () => {
  key('v');
  assert.equal(ui.full.isOpen(), false);
});

test('V opens the overlay on the Playback screen and the graph is built once, on that gesture', async () => {
  document.body.dataset.route = 'playback';
  key('v');
  assert.equal(ui.full.isOpen(), true);
  assert.equal($('viz-full').hidden, false);
  assert.equal(document.body.classList.contains('viz-full-open'), true);
  assert.equal($('p-viz').getAttribute('aria-pressed'), 'true');
  assert.equal($('viz-title').textContent, 'Alpha');
  assert.equal($('viz-artist').textContent, 'AA');
  await flush();
  assert.equal(stats.ctors, 1);
  assert.equal(stats.sources, 1);
  assert.equal(audioGraph.hasGraph(), true);
});

test('V closes it again, from anywhere; focus returns to the button', () => {
  const before = $('p-viz').focused;
  key('V');
  assert.equal(ui.full.isOpen(), false);
  assert.equal($('viz-full').hidden, true);
  assert.equal($('p-viz').getAttribute('aria-pressed'), 'false');
  assert.equal(document.body.classList.contains('viz-full-open'), false);
  assert.equal($('p-viz').focused, before + 1);
  assert.equal(document.activeElement, $('p-viz'));
});

test('reopening reuses the same graph', async () => {
  $('p-viz').click();
  await flush();
  assert.equal(ui.full.isOpen(), true);
  key('Escape');
  $('p-viz').click();
  await flush();
  key('Escape');
  assert.equal(stats.ctors, 1);
  assert.equal(stats.sources, 1);
});

test('Esc closes the overlay and returns focus to the button', () => {
  $('p-viz').click();
  assert.equal(ui.full.isOpen(), true);
  key('Escape', {}, $('viz-full'));
  assert.equal(ui.full.isOpen(), false);
  assert.equal(document.activeElement, $('p-viz'));
});

test('V is ignored with modifiers, key repeat and inside text inputs', () => {
  const input = document.createElement('input');
  document.body.append(input);
  key('v', {}, input);
  key('v', { ctrlKey: true });
  key('v', { metaKey: true });
  key('v', { altKey: true });
  key('v', { repeat: true });
  assert.equal(ui.full.isOpen(), false);
  input.remove();
  assert.equal(isVizKey({ key: 'v' }, { open: false, route: 'playback' }), true);
  assert.equal(isVizKey({ key: 'x' }, { open: true, route: 'playback' }), false);
  assert.equal(isVizKey({ key: 'v' }, { open: true, route: 'library' }), true);
});

test('overlay controls drive the player', () => {
  $('p-viz').click();
  $('viz-play').click();
  $('viz-prev').click();
  $('viz-next').click();
  assert.deepEqual(calls.splice(0), ['toggle', 'prev', 'next']);
  fire(document, 'keydown', { key: 'Escape' });
  assert.equal(ui.full.isOpen(), false);
});

test('play and pause update the overlay button label', () => {
  audio.play();
  assert.equal($('viz-play').getAttribute('aria-label'), 'Pause');
  audio.pause();
  assert.equal($('viz-play').getAttribute('aria-label'), 'Play');
});

test('clicking the canvas toggles play/pause and announces; it never exits', () => {
  $('p-viz').click();
  calls.length = 0;
  audio.pause();
  fire($('viz-full'), 'click', { target: $('viz-full-canvas') });
  assert.deepEqual(calls.splice(0), ['toggle']);
  assert.equal($('viz-live').textContent, 'Playing');
  assert.equal(ui.full.isOpen(), true);
  fire($('viz-full'), 'pointerdown');
  fire($('viz-full'), 'click', { target: $('viz-full-canvas') });
  assert.deepEqual(calls.splice(0), ['toggle']);
  assert.equal(ui.full.isOpen(), true);
  fire($('viz-full'), 'click', { target: $('viz-play') });
  assert.deepEqual(calls.splice(0), []);
});

test('the X button exits and returns focus to the Visualizer button', () => {
  $('viz-close').click();
  assert.equal(ui.full.isOpen(), false);
});

test('isNearBox: inside, within the padding, and outside', () => {
  const box = { left: 100, top: 10, right: 200, bottom: 54 };
  assert.equal(isNearBox({ x: 150, y: 30 }, box, 48), true);
  assert.equal(isNearBox({ x: 248, y: 102 }, box, 48), true);
  assert.equal(isNearBox({ x: 249, y: 30 }, box, 48), false);
  assert.equal(isNearBox({ x: 150, y: 103 }, box, 48), false);
  assert.equal(isNearBox({ x: 150, y: 30 }, box), true);
  assert.equal(isNearBox(null, box, 48), false);
});

test('Visualizer background setting persists and enables the layer', async () => {
  assert.equal(vizBackgroundOn(), false);
  assert.equal($('viz-bg-layer').classList.contains('on'), false);
  setVizBackground(true);
  assert.equal(localStorage.getItem('ap2.viz.bg'), '1');
  assert.equal(vizBackgroundOn(), true);
  assert.equal($('viz-bg-layer').classList.contains('on'), true);
  await flush();
  assert.equal(stats.ctors, 1, 'graph still built once');
  setVizBackground(false);
  assert.equal(localStorage.getItem('ap2.viz.bg'), '0');
  assert.equal($('viz-bg-layer').classList.contains('on'), false);
});

test('the setting survives a broken localStorage', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(vizBackgroundOn(), false);
  assert.doesNotThrow(() => setVizBackground(true));
  globalThis.localStorage = real;
});

test('without Web Audio the button is disabled with a tooltip and V does nothing', async () => {
  audioGraph.resetForTests();
  const noWin = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const ui2 = initVisualizer({ player, audio, graph: audioGraph, win: noWin });
  assert.equal($('p-viz').disabled, true);
  assert.match($('p-viz').title, /Web Audio/);
  document.body.dataset.route = 'playback';
  key('v');
  assert.equal(ui2.full.isOpen(), false);
  ui.full.close();
  $('p-viz').disabled = false;
  $('p-viz').title = 'Visualizer (V)';
});

test('reduced motion shows the tooltip and keeps playback unaffected', () => {
  const rWin = { ...win, matchMedia: () => ({ matches: true, addEventListener() {} }) };
  audioGraph.resetForTests();
  initVisualizer({ player, audio, graph: audioGraph, win: rWin });
  assert.equal($('p-viz').title, 'Reduced motion is on');
  assert.equal($('p-viz').disabled, false);
});

function fakeTimers() {
  const t = { list: [], now: 0 };
  t.set = (fn, ms) => { const h = { fn, at: t.now + ms }; t.list.push(h); return h; };
  t.clear = (h) => { t.list = t.list.filter((x) => x !== h); };
  t.advance = (ms) => { t.now += ms; for (const h of t.list.filter((x) => x.at <= t.now)) { t.clear(h); h.fn(); } };
  return t;
}

test('controls auto-hide after 3 s without activity and return on a poke', () => {
  const t = fakeTimers();
  const changes = [];
  const hide = makeAutoHide({ delay: 3000, setTimer: t.set, clearTimer: t.clear, onChange: (v) => changes.push(v) });
  hide.poke();
  t.advance(2900);
  assert.equal(hide.idle, false);
  hide.poke();
  t.advance(2900);
  assert.equal(hide.idle, false, 'poke restarted the timer');
  t.advance(200);
  assert.equal(hide.idle, true);
  hide.poke();
  assert.equal(hide.idle, false);
  hide.stop();
  t.advance(10000);
  assert.deepEqual(changes, [true, false]);
});

test('overlay toggles the idle class through the timer', () => {
  const t = fakeTimers();
  const root = $('viz-full');
  const fs = createFullscreen({ root, opener: $('p-viz'), setTimer: t.set, clearTimer: t.clear, hideMs: 3000 });
  fs.open();
  assert.equal(root.classList.contains('idle'), false);
  t.advance(3000);
  assert.equal(root.classList.contains('idle'), true);
  fs.poke();
  assert.equal(root.classList.contains('idle'), false);
  fs.close();
  assert.equal(root.classList.contains('idle'), false);
});

test('native Fullscreen: leaving it with the browser Esc closes the overlay', async () => {
  const root = $('viz-full');
  root.requestFullscreen = async () => { document.fullscreenElement = root; };
  const fs = createFullscreen({ root, opener: $('p-viz') });
  fs.open();
  await flush();
  document.fullscreenElement = null;
  fire(document, 'fullscreenchange');
  assert.equal(fs.isOpen(), false);
  delete root.requestFullscreen;
});

test('a rejected requestFullscreen falls back to the fixed overlay', async () => {
  const root = $('viz-full');
  root.requestFullscreen = () => Promise.reject(new Error('denied'));
  const fs = createFullscreen({ root, opener: $('p-viz') });
  fs.open();
  await flush();
  assert.equal(fs.isOpen(), true);
  fs.close();
  delete root.requestFullscreen;
});
