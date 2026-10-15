import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const saved = {};
globalThis.localStorage = {
  getItem: (k) => (k in saved ? saved[k] : null),
  setItem: (k, v) => { saved[k] = String(v); },
  removeItem: (k) => { delete saved[k]; },
};
const { createMirrorPanel } = await import('./viz-mirror-panel.js');
const S = await import('./viz-mirror-settings.js');
const { drawBars, barGeometry } = await import('./viz-bars.js');
const { FALLBACK_COLORS } = await import('./viz-color.js');

const fire = (node, type) => node.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true })));
const rows = (p) => p.el.querySelectorAll('label.viz-synth-row');
const rowOf = (p, label) => [...rows(p)].find((r) => r.querySelector('.viz-synth-name').textContent === label);
const reset = () => { for (const k of Object.keys(saved)) delete saved[k]; S.resetMirrorForTests(); };

test('one named control per schema field, grouped', () => {
  reset();
  const p = createMirrorPanel({ doc: document });
  assert.equal(rows(p).length, S.MIRROR_SCHEMA.length);
  assert.equal(p.el.getAttribute('aria-label'), 'Mirrored spectrum style');
  for (const r of rows(p)) {
    assert.ok(r.querySelector('.viz-synth-name').textContent.length > 0);
    assert.equal(r.querySelectorAll('input, select').length, 1);
  }
  assert.deepEqual(p.el.querySelectorAll('details.viz-synth-group').map((g) => g.dataset.group), S.MIRROR_GROUPS);
  p.destroy();
});

test('edits persist under ap2.viz.mirror and reset restores defaults', () => {
  reset();
  const p = createMirrorPanel({ doc: document });
  const input = rowOf(p, 'Bar width (px)').querySelector('input');
  input.value = '8';
  fire(input, 'input');
  assert.equal(S.getMirror().barWidth, 8);
  assert.equal(JSON.parse(saved[S.MIRROR_KEY]).barWidth, 8);
  assert.match(p.el.querySelector('.viz-synth-count').textContent, /^~\d+ bars$/);
  const sw = rowOf(p, 'Horizon glow').querySelector('input');
  sw.checked = false;
  fire(sw, 'change');
  assert.equal(S.getMirror().horizon, false);
  p.el.querySelector('.viz-synth-reset-all').click();
  assert.deepEqual(S.getMirror(), S.defaultMirror());
  assert.equal(input.value, '0');
  assert.equal(rowOf(p, 'Bar width (px)').querySelector('output').textContent, 'Auto');
  p.destroy();
});

test('group reset only touches its group', () => {
  reset();
  S.setMirror('barWidth', 9);
  S.setMirror('rise', 0.3);
  S.resetMirror('Bars');
  assert.equal(S.getMirror().barWidth, 0);
  assert.equal(S.getMirror().rise, 0.3);
});

test('invalid stored data repairs to defaults', () => {
  reset();
  saved[S.MIRROR_KEY] = JSON.stringify({ v: 1, barWidth: 199, gradient: 'nope', horizon: 'x', fall: 0.2 });
  const m = S.getMirror();
  assert.equal(m.barWidth, 80);
  assert.equal(m.gradient, 'theme');
  assert.equal(m.horizon, true);
  assert.equal(m.fall, 0.2);
  saved[S.MIRROR_KEY] = '{bad';
  S.resetMirrorForTests();
  assert.deepEqual(S.getMirror(), S.defaultMirror());
});

test('mirrorColors reorders token stops, never invents colours', () => {
  const c = FALLBACK_COLORS;
  assert.equal(S.mirrorColors(c, 'theme'), c);
  assert.deepEqual(S.mirrorColors(c, 'reversed').stops, [...c.stops].reverse());
  assert.ok(S.mirrorColors(c, 'accent').stops.every((s) => s === c.accent));
  assert.equal(S.mirrorColors(c, 'accent'), S.mirrorColors(c, 'accent'));
});

test('bar width fraction widens bars and options reach the canvas', () => {
  assert.ok(barGeometry(100, 1000, 1, 0.9).barDev > barGeometry(100, 1000, 1, 0.3).barDev);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { calls.push([k, a]); }), set: () => true });
  const vals = new Float32Array(50).fill(0.5);
  drawBars(ctx, 500, 200, vals, { colors: FALLBACK_COLORS, glow: true });
  const withGlow = calls.filter(([k]) => k === 'fillRect').length;
  calls.length = 0;
  drawBars(ctx, 500, 200, vals, { colors: FALLBACK_COLORS, glow: false });
  assert.equal(calls.filter(([k]) => k === 'fillRect').length, 0);
  assert.ok(withGlow > 0);
});

test('new settings are validated and neutral by default', () => {
  const d = S.defaultMirror();
  assert.equal(d.segments, 0);
  assert.equal(d.tips, false);
  assert.equal(d.band, 0);
  assert.equal(d.backdrop, 'none');
  assert.equal(d.direction, 'horizontal');
  const bad = S.validateMirror({ v: 1, segments: 99, segmentGap: 0, tips: 'x', direction: 'diag', backdrop: 'fire', gradient: 'ice', band: 5 });
  assert.equal(bad.segments, 48);
  assert.equal(bad.segmentGap, 0.1);
  assert.equal(bad.tips, false);
  assert.equal(bad.direction, 'horizontal');
  assert.equal(bad.backdrop, 'none');
  assert.equal(bad.gradient, 'ice');
  assert.equal(bad.band, 1);
});

test('mirrorColors ice uses the ice stops and a light line colour', () => {
  const c = FALLBACK_COLORS;
  const v = S.mirrorColors(c, 'ice');
  assert.deepEqual(v.stops, c.ice.stops);
  assert.deepEqual(v.line, c.ice.stops[3]);
  assert.equal(S.mirrorColors(c, 'ice'), v);
  assert.equal(S.mirrorColors({ stops: c.stops, line: c.line }, 'ice').line, c.line);
});

test('pixel bars: auto is the classic formula, px mode clamps count and keeps the ratio', async () => {
  const { pixelBars, barCount } = await import('./viz-spectrum.js');
  for (const w of [800, 1200, 1900]) {
    const a = pixelBars(w, 0, 2);
    assert.equal(a.count, barCount(w));
    assert.equal(a.fraction, 0.6);
  }
  assert.equal(pixelBars(1200, 6, 2).count, 150);
  assert.equal(pixelBars(1200, 6, 2).fraction, 0.75);
  assert.equal(pixelBars(300, 12, 8).count, 48);
  assert.equal(pixelBars(375, 40, 6).count, 8);
  assert.equal(pixelBars(1200, 40, 6).count, 26);
  assert.equal(pixelBars(300, 40, 20).count, 8);
  assert.equal(pixelBars(4000, 2, 0).count, 600);
  assert.equal(pixelBars(1200, 6, 0).minGapCss, 0);
  assert.equal(pixelBars(1200, 6, 1).minGapCss, 1);
  assert.equal(barGeometry(150, 1200, 1, 1, 0).barDev, 8);
});

test('px settings are floored, Auto is 0, and old density/width/height migrate once', () => {
  reset();
  assert.equal(S.validateMirror({ v: 1, barWidth: 1, maxHeight: 5 }).barWidth, 2);
  assert.equal(S.validateMirror({ v: 1, maxHeight: 5 }).maxHeight, 20);
  assert.equal(S.validateMirror({ v: 1, maxHeight: 900 }).maxHeight, 600);
  const d = S.defaultMirror();
  assert.equal(d.barWidth, 0);
  assert.equal(d.maxHeight, 0);
  const same = S.validateMirror({ v: 1, density: 1, width: 0.6, height: 1, rise: 0.3 });
  assert.equal(same.barWidth, 0);
  assert.equal(same.maxHeight, 0);
  assert.equal(same.rise, 0.3);
  const old = S.validateMirror({ v: 1, density: 0.5, width: 0.8, height: 1.1 });
  assert.equal(old.barWidth, 6);
  assert.equal(old.gap, 2);
  assert.equal(old.maxHeight, 175);
  const junk = S.validateMirror({ v: 1, density: 'x', width: null });
  assert.equal(junk.barWidth, 0);
  const fresh = S.validateMirror({ v: 1, barWidth: 5, density: 0.5, width: 0.9 });
  assert.equal(fresh.barWidth, 5);
});

test('maxHeightPx caps the bars at that many css px and Auto keeps the old half-height', async () => {
  const { barHeights } = await import('./viz-bars.js');
  const run = (extra) => {
    const calls = [];
    const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { calls.push([k, a]); }), set: () => true });
    drawBars(ctx, 600, 400, new Float32Array(50).fill(1), { colors: FALLBACK_COLORS, glow: false, ...extra });
    return Math.max(...calls.filter(([k]) => k === 'rect').map(([, a]) => a[3]));
  };
  const auto = run({});
  assert.ok(Math.abs(auto - 0.8 * 200) < 1e-6);
  assert.ok(Math.abs(run({ maxHeightPx: 100 }) - 100) < 1e-6);
  assert.ok(Math.abs(run({ maxHeightPx: 600 }) - 0.95 * 200) < 1e-6);
  assert.equal(barHeights.length >= 0, true);
});

test('History trail settings: neutral defaults, validated ranges', () => {
  const d = S.defaultMirror();
  assert.equal(d.sectorMode, 'off');
  assert.deepEqual([d.visitsPerStep, d.loss, d.maxLevel, d.trailMax, d.stepGain, d.minDwell], [5, 1, 6, 0.8, 0.14, 60]);
  const v = S.validateMirror({ sectorMode: 'x', visitsPerStep: 99, loss: -3, maxLevel: 0, trailMax: 5, stepGain: 0 });
  assert.equal(v.sectorMode, 'off');
  assert.equal(v.visitsPerStep, 30);
  assert.equal(v.loss, 0);
  assert.equal(v.maxLevel, 1);
  assert.equal(v.trailMax, 1);
  assert.equal(v.stepGain, 0.05);
  assert.ok(S.MIRROR_GROUPS.includes('History trail'));
});

test('ice2 gradient: ramp is light-to-dark by luminance, base first after mirrorColors', async () => {
  const { FALLBACK_COLORS } = await import('./viz-color.js');
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const st = FALLBACK_COLORS.ice2.stops;
  assert.equal(st.length, 8);
  for (let k = 1; k < st.length; k += 1) assert.ok(lum(st[k]) > lum(st[k - 1]), `stop ${k}`);
  const g = S.mirrorColors(FALLBACK_COLORS, 'ice2');
  assert.deepEqual(g.stops[0], st[7]);
  assert.deepEqual(g.stops.at(-1), st[0]);
  assert.deepEqual(g.line, st[7]);
  assert.equal(S.mirrorColors(FALLBACK_COLORS, 'ice').stops, FALLBACK_COLORS.ice.stops);
  assert.equal(S.mirrorColors(FALLBACK_COLORS, 'theme'), FALLBACK_COLORS);
  assert.equal(S.mirrorColors({ ...FALLBACK_COLORS, ice2: undefined }, 'ice2').stops, FALLBACK_COLORS.stops);
});
