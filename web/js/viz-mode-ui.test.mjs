import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, fire, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const audioGraph = await import('./audio-graph.js');
const { initVisualizer } = await import('./viz-ui.js');
const { createFullscreen, makeAutoHide, isVizKey } = await import('./viz-fullscreen.js');


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


const { vizMode, setVizMode, vizHeightId, vizHeightScale, setVizHeight, resetVizCapsForTests } = await import('./viz-settings.js');
const sw = () => [...$('viz-switch').children];

test('mode switch is a radiogroup of the available modes with one checked radio', () => {
  assert.equal($('viz-switch').getAttribute('role'), 'radiogroup');
  assert.deepEqual(sw().map((b) => b.dataset.mode), ['bars', 'ring']);
  assert.deepEqual(sw().map((b) => b.getAttribute('aria-label')), ['Mirrored spectrum', 'Ring']);
  assert.deepEqual(sw().map((b) => b.getAttribute('aria-checked')), ['true', 'false']);
  assert.deepEqual(sw().map((b) => b.tabIndex), [0, -1]);
  assert.equal($('viz-switch').hidden, false);
});

test('clicking a radio switches the mode, persists it and announces it', () => {
  sw()[1].click();
  assert.equal(localStorage.getItem('ap2.viz.mode'), 'ring');
  assert.equal(ui.fullViz.effectiveMode(), 'ring');
  assert.equal(ui.bgViz.effectiveMode(), 'ring');
  assert.equal($('viz-live').textContent, 'Visualizer: Ring');
  assert.deepEqual(sw().map((b) => b.getAttribute('aria-checked')), ['false', 'true']);
  assert.deepEqual([...$('p-viz-switch').children].map((b) => b.getAttribute('aria-checked')), ['false', 'true']);
});

test('arrow keys move the checked radio and wrap', () => {
  fire(sw()[1], 'keydown', { key: 'ArrowRight' });
  assert.equal(vizMode(), 'bars');
  fire(sw()[0], 'keydown', { key: 'ArrowLeft' });
  assert.equal(vizMode(), 'ring');
  fire(sw()[1], 'keydown', { key: 'Home' });
  assert.equal(vizMode(), 'bars');
  fire(sw()[0], 'keydown', { key: 'End' });
  assert.equal(vizMode(), 'ring');
});

test('M cycles modes while the overlay is open; ignored in inputs, closed on other routes', () => {
  assert.equal(vizMode(), 'ring');
  if (!ui.full.isOpen()) $('p-viz').click();
  key('m');
  assert.equal(vizMode(), 'bars');
  assert.equal($('viz-live').textContent, 'Visualizer: Mirrored spectrum');
  key('M');
  assert.equal(vizMode(), 'ring');
  const input = document.createElement('input');
  document.body.append(input);
  key('m', {}, input);
  assert.equal(vizMode(), 'ring');
  key('m', { ctrlKey: true });
  assert.equal(vizMode(), 'ring');
  $('viz-close').click();
  key('m');
  assert.equal(vizMode(), 'ring');
  input.remove?.();
});

test('saved mode migration, validation and WebGL skip', () => {
  const noGL = () => ({ webgl: false });
  const table = [['bars-ring', 'bars'], ['combo', 'bars'], ['terrain', 'bars'], ['ring', 'ring'], ['bogus', 'bars'], [null, 'bars']];
  for (const [saved, want] of table) {
    if (saved == null) localStorage.removeItem('ap2.viz.mode'); else localStorage.setItem('ap2.viz.mode', saved);
    assert.equal(vizMode(noGL), want, String(saved));
  }
  localStorage.setItem('ap2.viz.mode', 'combo');
  assert.equal(vizMode(() => ({ webgl: true })), 'terrain');
  setVizMode('nope');
  assert.equal(localStorage.getItem('ap2.viz.mode'), 'bars');
  resetVizCapsForTests(null);
});

test('height setting: default 1/6, persisted, validated, applied to both layers', () => {
  localStorage.removeItem('ap2.viz.height');
  assert.equal(vizHeightId(), 'small');
  assert.ok(Math.abs(vizHeightScale() - 1 / 6) < 1e-9);
  setVizHeight('medium');
  assert.equal(localStorage.getItem('ap2.viz.height'), 'medium');
  assert.ok(Math.abs(vizHeightScale() - 1 / 3) < 1e-9);
  setVizHeight('huge');
  assert.equal(vizHeightId(), 'small');
});
