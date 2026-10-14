import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, fire, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const audioGraph = await import('./audio-graph.js');
const { initVisualizer } = await import('./viz-ui.js');
const { createFullscreen, makeAutoHide, isVizKey } = await import('./viz-fullscreen.js');
const { stepIndex, modeOptions, currentIndex, moveFocus, opensUpward } = await import('./viz-switch.js');


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
const dd = (id = 'viz-switch') => $(id);
const btn = (id) => dd(id).children[0];
const list = (id) => dd(id).children[1];
const opts = (id) => [...list(id).children];

test('mode switch is a dropdown: button with listbox popup of the available modes', () => {
  assert.equal(btn('viz-switch').getAttribute('aria-haspopup'), 'listbox');
  assert.equal(btn('viz-switch').getAttribute('aria-expanded'), 'false');
  assert.equal(btn('viz-switch').getAttribute('aria-label'), 'Visualizer mode: Mirrored spectrum');
  assert.equal(list('viz-switch').getAttribute('role'), 'listbox');
  assert.equal(list('viz-switch').hidden, true);
  assert.deepEqual(opts('viz-switch').map((o) => o.dataset.mode), ['bars', 'ring']);
  assert.ok(opts('viz-switch').every((o) => o.getAttribute('role') === 'option'));
  assert.deepEqual(opts('viz-switch').map((o) => o.getAttribute('aria-selected')), ['true', 'false']);
  assert.equal($('viz-switch').hidden, false);
});

test('opening focuses the current option; clicking another selects, persists, announces and closes', () => {
  btn('viz-switch').click();
  assert.equal(btn('viz-switch').getAttribute('aria-expanded'), 'true');
  assert.equal(list('viz-switch').hidden, false);
  assert.equal(document.activeElement, opts('viz-switch')[0]);
  opts('viz-switch')[1].click();
  assert.equal(list('viz-switch').hidden, true);
  assert.equal(btn('viz-switch').getAttribute('aria-expanded'), 'false');
  assert.equal(localStorage.getItem('ap2.viz.mode'), 'ring');
  assert.equal(ui.fullViz.effectiveMode(), 'ring');
  assert.equal(ui.bgViz.effectiveMode(), 'ring');
  assert.equal($('viz-live').textContent, 'Visualizer: Ring');
  assert.deepEqual(opts('viz-switch').map((o) => o.getAttribute('aria-selected')), ['false', 'true']);
  assert.deepEqual(opts('p-viz-switch').map((o) => o.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(btn('p-viz-switch').getAttribute('aria-label'), 'Visualizer mode: Ring');
});

test('keyboard: arrows move focus, Enter selects, Escape closes the popup', () => {
  fire(btn('viz-switch'), 'keydown', { key: 'ArrowDown' });
  assert.equal(list('viz-switch').hidden, false);
  assert.equal(document.activeElement, opts('viz-switch')[1]);
  fire(list('viz-switch'), 'keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, opts('viz-switch')[0]);
  fire(list('viz-switch'), 'keydown', { key: 'End' });
  assert.equal(document.activeElement, opts('viz-switch')[1]);
  fire(list('viz-switch'), 'keydown', { key: 'Home' });
  fire(list('viz-switch'), 'keydown', { key: 'Enter' });
  assert.equal(vizMode(), 'bars');
  assert.equal(list('viz-switch').hidden, true);
  assert.equal(document.activeElement, btn('viz-switch'));
  btn('viz-switch').click();
  fire(list('viz-switch'), 'keydown', { key: 'Escape' });
  assert.equal(list('viz-switch').hidden, true);
  assert.equal(vizMode(), 'bars');
  setVizMode('ring');
});

test('outside pointerdown closes the popup', () => {
  btn('p-viz-switch').click();
  assert.equal(list('p-viz-switch').hidden, false);
  fire(document.body, 'pointerdown', {});
  assert.equal(list('p-viz-switch').hidden, true);
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
  fire(document, 'keydown', { key: 'Escape' });
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

test('dropdown pure logic', () => {
  const modes = [{ id: 'a', label: 'A', icon: 'x' }, { id: 'b', label: 'B', icon: 'y' }, { id: 'c', label: 'C', icon: 'z' }];
  assert.deepEqual(modeOptions(modes, 'b').map((o) => o.selected), [false, true, false]);
  assert.equal(currentIndex(modes, 'c'), 2);
  assert.equal(currentIndex(modes, 'nope'), 0);
  assert.equal(moveFocus(0, 'ArrowUp', 3), 2);
  assert.equal(moveFocus(2, 'ArrowDown', 3), 0);
  assert.equal(moveFocus(1, 'Home', 3), 0);
  assert.equal(moveFocus(1, 'End', 3), 2);
  assert.equal(moveFocus(1, 'x', 3), 1);
  assert.equal(stepIndex(0, 'ArrowLeft', 3), 2);
  assert.equal(opensUpward({ top: 700, bottom: 744 }, 140, 800), true);
  assert.equal(opensUpward({ top: 20, bottom: 64 }, 140, 800), false);
  assert.equal(opensUpward({ top: 300, bottom: 344 }, 140, 800), false);
});

test('exit and share live in the top-right cluster; dialog describes how to exit', async () => {
  const html = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="viz-corner" id="viz-corner">\s*<button[^>]*id="viz-share"[^>]*>\s*<\/button>\s*<button[^>]*id="viz-close"[^>]*aria-label="Exit full screen"/);
  assert.match(html, /id="viz-full"[^>]*aria-describedby="viz-exit-hint"/);
  assert.match(html, /id="viz-exit-hint">Press Escape or use the Exit button to leave\. Click the picture to pause or play\./);
});

test('part toggles are gone from the bottom control rows', async () => {
  const html = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(p-)?viz-parts"/);
});
