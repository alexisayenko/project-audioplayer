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
const btn = (id) => dd(id).querySelector('.viz-dd-btn');
const list = (id) => dd(id).querySelector('[role="listbox"]');
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
  assert.equal($('viz-live').textContent, 'Visualizer: Ring');
  assert.deepEqual(opts('viz-switch').map((o) => o.getAttribute('aria-selected')), ['false', 'true']);
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
  btn('viz-switch').click();
  assert.equal(list('viz-switch').hidden, false);
  fire(document.body, 'pointerdown', {});
  assert.equal(list('viz-switch').hidden, true);
});

test('M cycles modes while the overlay is open; ignored in inputs, closed on other routes', () => {
  assert.equal(vizMode(), 'ring');
  if (!ui.full.isOpen()) $('mini-viz').click();
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
  const table = [['bars-ring', 'bars'], ['combo', 'bars'], ['terrain', 'bars'], ['synthwave', 'bars'], ['ring', 'ring'], ['bogus', 'bars'], [null, 'bars']];
  for (const [saved, want] of table) {
    if (saved == null) localStorage.removeItem('ap2.viz.mode'); else localStorage.setItem('ap2.viz.mode', saved);
    assert.equal(vizMode(noGL), want, String(saved));
  }
  localStorage.setItem('ap2.viz.mode', 'combo');
  assert.equal(vizMode(() => ({ webgl: true })), 'terrain');
  localStorage.setItem('ap2.viz.mode', 'synthwave');
  assert.equal(vizMode(() => ({ webgl: true })), 'synthwave');
  assert.equal(vizMode(noGL), 'bars');
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
  assert.match(html, /<div class="viz-corner" id="viz-corner">\s*<button[^>]*id="viz-share"[^>]*>\s*<\/button>\s*<button[^>]*id="viz-settings"[^>]*>\s*<\/button>\s*<button[^>]*id="viz-close"[^>]*aria-label="Exit full screen"/);
  assert.match(html, /id="viz-full"[^>]*aria-describedby="viz-exit-hint"/);
  assert.match(html, /id="viz-exit-hint">Press Escape or use the Exit button to leave\. Click the picture to pause or play\./);
});

test('part toggles are gone from the bottom control rows', async () => {
  const html = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(p-)?viz-parts"/);
});

test('overlay volume slider keeps a fixed footprint: hover and focus only change opacity', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../viz.css', import.meta.url), 'utf8');
  const base = css.match(/\.viz-vol-slider \{[^}]*\}/g).join(' ');
  assert.match(base, /flex: none/);
  assert.match(base, /width: 96px/);
  const rules = css.match(/@media \(hover: hover\)[^{]*\{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(rules, /(^|[^-])width\s*:/);
  assert.doesNotMatch(rules, /flex-basis|display\s*:/);
  assert.match(rules, /\.viz-vol:hover \.viz-vol-slider[^{]*\{ opacity: 1; \}/);
  assert.match(rules, /\.viz-vol-slider \{ opacity: 0; transition: opacity/);
});

test('the switch pill style is scoped to the Camera flight switch, not the mode dropdown container', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../viz.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('./viz-panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.viz-switch::after/);
  assert.match(css, /\.viz-flag-switch::after/);
  assert.match(panel, /className = 'viz-flag-switch'/);
  assert.match(panel, /setAttribute\('role', 'switch'\)/);
  const row = html.match(/<div class="viz-keys">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
  assert.doesNotMatch(row, /role="switch"/);
});

function manualTimers() {
  const t = { list: [], now: 0 };
  t.set = (fn, ms) => { const h = { fn, at: t.now + ms }; t.list.push(h); return h; };
  t.clear = (h) => { t.list = t.list.filter((x) => x !== h); };
  t.advance = (ms) => { t.now += ms; for (const h of t.list.filter((x) => x.at <= t.now)) { t.clear(h); h.fn(); } };
  return t;
}

test('auto-hide waits while the keep guard (hover, focus, drag) holds, then hides once it lets go', () => {
  const t = manualTimers();
  let held = true;
  const changes = [];
  const hide = makeAutoHide({ delay: 3000, setTimer: t.set, clearTimer: t.clear, keep: () => held, onChange: (v) => changes.push(v) });
  hide.poke();
  t.advance(9000);
  assert.equal(hide.idle, false);
  held = false;
  t.advance(3000);
  assert.equal(hide.idle, true);
  hide.poke();
  assert.deepEqual(changes, [true, false]);
});

test('the overlay idle class (dock and controls) follows the timer and the keep guard', () => {
  const t = manualTimers();
  const root = $('viz-full');
  let held = false;
  const fs = createFullscreen({ root, opener: $('mini-viz'), keep: () => held, setTimer: t.set, clearTimer: t.clear, hideMs: 3000 });
  fs.open();
  held = true;
  t.advance(3000);
  assert.equal(root.classList.contains('idle'), false);
  held = false;
  t.advance(3000);
  assert.equal(root.classList.contains('idle'), true);
  fs.poke();
  assert.equal(root.classList.contains('idle'), false);
  fs.close();
});

test('CSS hides the overlay dock with the controls: opacity and visibility, no pointer events, token durations', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../viz.css', import.meta.url), 'utf8');
  assert.match(css, /\.viz-full\.idle \.viz-ctl, \.viz-full\.idle > \.viz-dock \{ opacity: 0; visibility: hidden; pointer-events: none; \}/);
  assert.match(css, /\.viz-full > \.viz-dock \{ transition: opacity var\(--dur-slow\) var\(--ease-out\), visibility var\(--dur-slow\);/);
  assert.doesNotMatch(css, /\.idle[^{]*\.viz-dock \{[^}]*display/);
});

test('a fallback note is shown on the mode button and cleared when the mode is set again', async () => {
  const { createModeSwitch } = await import('./viz-switch.js');
  const root = document.createElement('div');
  document.body.append(root);
  const modes = [{ id: 'terrain', label: 'Terrain', icon: 'terrain' }, { id: 'synthwave', label: 'Synthwave terrain', icon: 'synthwave' }];
  const sw = createModeSwitch({ root, modes, current: 'synthwave', onSelect() {} });
  const text = () => root.children[0].textContent;
  assert.equal(text(), 'Synthwave terrain');
  sw.setNote('using Terrain: too heavy');
  assert.equal(text(), 'Synthwave terrain (using Terrain: too heavy)');
  assert.equal(root.children[0].getAttribute('aria-label'), 'Visualizer mode: Synthwave terrain (using Terrain: too heavy)');
  assert.equal(root.children[0].title, 'Visualizer mode: Synthwave terrain (using Terrain: too heavy)');
  sw.set('synthwave');
  assert.equal(text(), 'Synthwave terrain');
  root.remove();
});

const pageHtml = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (id) => { const a = pageHtml.indexOf(`<section id="${id}"`); return a < 0 ? '' : pageHtml.slice(a, pageHtml.indexOf('</section>', a)); };

test('the dock has a plain Visualizer key left of Shuffle, no dropdown or chevron; the mode menu lives in the overlay', () => {
  const mini = section('mini');
  assert.doesNotMatch(mini, /mini-viz-switch|viz-switch|viz-dd/);
  assert.match(mini, /<button class="key" id="mini-viz"[^>]*aria-label="Visualizer"[^>]*title="Visualizer \(V\)"/);
  assert.ok(mini.indexOf('id="mini-viz"') < mini.indexOf('id="mini-shuffle"'));
  assert.deepEqual([...mini.matchAll(/id="(mini-(?:viz|shuffle|prev|play|next|repeat))"/g)].map((m) => m[1]), ['mini-viz', 'mini-shuffle', 'mini-prev', 'mini-play', 'mini-next', 'mini-repeat']);
  assert.doesNotMatch(section('player'), /viz-switch/);
  assert.equal($('mini-viz-switch'), null);
  assert.equal($('p-viz'), null);
  assert.match(pageHtml, /id="viz-full"[\s\S]*id="viz-switch"/);
});

test('dock Visualizer key opens and closes the full screen and returns focus', () => {
  document.body.dataset.route = 'library';
  const k = $('mini-viz');
  assert.equal(ui.full.isOpen(), false);
  k.click();
  assert.equal(ui.full.isOpen(), true);
  assert.equal(k.getAttribute('aria-pressed'), 'true');
  ui.full.close();
  assert.equal(k.getAttribute('aria-pressed'), 'false');
  assert.equal(document.activeElement, k);
});

test('mode can be changed inside the full screen via the overlay dropdown', () => {
  ui.full.open();
  const before = vizMode();
  btn('viz-switch').click();
  opts('viz-switch').find((o) => o.dataset.mode !== before).click();
  assert.notEqual(vizMode(), before);
  ui.full.close();
  setVizMode(before);
});

test('element ids in index.html are unique', () => {
  const ids = [...pageHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});
