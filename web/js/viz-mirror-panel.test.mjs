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
  assert.deepEqual([d.visitsPerStep, d.window, d.maxLevel, d.minDwell, d.glow, d.glowSize], [3, 10, 8, 60, 0.8, 1]);
  const v = S.validateMirror({ sectorMode: 'x', visitsPerStep: 99, loss: -3, window: 500, maxLevel: 0, trailMax: 5, stepGain: 0 });
  assert.equal(v.sectorMode, 'off');
  assert.equal(v.visitsPerStep, 30);
  assert.equal(v.window, 60);
  assert.equal('loss' in v, false);
  assert.equal(S.validateMirror({ window: 0 }).window, 2);
  assert.equal(S.validateMirror({ loss: 3 }).window, 10);
  assert.equal(v.maxLevel, 1);
  assert.equal('trailMax' in v, false);
  assert.equal(S.validateMirror({ maxLevel: 12 }).maxLevel, 8);
  assert.equal('stepGain' in v, false);
  assert.ok(S.MIRROR_GROUPS.includes('History trail'));
});

function labOf(c) {
  const lin = c.map((q) => { const x = q / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const X = (0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2]) / 0.95047;
  const Y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  const Z = (0.0193339 * lin[0] + 0.119192 * lin[1] + 0.9503041 * lin[2]) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function dE2000(l1, l2) {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => ((Math.atan2(b, a) / rad) + 360) % 360;
  const h1 = Cp1 === 0 ? 0 : hp(b1, ap1);
  const h2 = Cp2 === 0 ? 0 : hp(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = h2 - h1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lm = (L1 + L2) / 2;
  const Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2;
  if (Cp1 * Cp2 === 0) hm = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hm /= 2;
  else hm = (hm + (hm < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

test('ice2 gradient: 10-stop ramp, no big lightness gap, saturated, base first after mirrorColors', async () => {
  const { FALLBACK_COLORS } = await import('./viz-color.js');
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const st = FALLBACK_COLORS.ice2.stops;
  assert.equal(st.length, 11);
  for (let k = 1; k < st.length; k += 1) {
    assert.ok(lum(st[k]) > lum(st[k - 1]), `stop ${k}`);
    const d = dE2000(labOf(st[k - 1]), labOf(st[k]));
    assert.ok(d < 15, `dE2000 ${k - 1}->${k} = ${d}`);
  }
  const hsv = (c) => {
    const [r, g2, b] = c.map((q) => q / 255);
    const mx = Math.max(r, g2, b);
    const d = mx - Math.min(r, g2, b);
    const h = d === 0 ? 0 : mx === r ? ((g2 - b) / d + 6) % 6 : mx === g2 ? (b - r) / d + 2 : (r - g2) / d + 4;
    return { h: h * 60, s: mx ? d / mx : 0, v: mx };
  };
  const dim = FALLBACK_COLORS.ice2.dim;
  assert.deepEqual(dim, st.slice(0, 4));
  dim.forEach((c, k) => {
    const o = hsv(c);
    assert.ok(o.h >= 205 && o.h <= 232 && o.s >= 0.6 && o.s <= 0.95, `swatch ${k} ${o.h} ${o.s}`);
  });
  st.forEach((c, k) => {
    const o = hsv(c);
    assert.ok(o.h >= (k < 4 ? 205 : k < 8 ? 196 : 185) && o.h <= 232, `hue ${k} ${o.h}`);
    if (k >= 4 && k < 8) assert.ok(o.s >= 0.55, `sat ${k}`);
    else if (k >= 8) assert.ok(o.s >= 0.03);
    if (k) assert.ok(o.v >= hsv(st[k - 1]).v, `value ${k}`);
  });
  const g = S.mirrorColors(FALLBACK_COLORS, 'ice2');
  assert.deepEqual(g.stops[0], st[10]);
  assert.deepEqual(g.stops.at(-1), st[0]);
  assert.deepEqual(g.line, st[10]);
  assert.equal(S.mirrorColors(FALLBACK_COLORS, 'ice').stops, FALLBACK_COLORS.ice.stops);
  assert.equal(S.mirrorColors(FALLBACK_COLORS, 'theme'), FALLBACK_COLORS);
  assert.equal(S.mirrorColors({ ...FALLBACK_COLORS, ice2: undefined }, 'ice2').stops, FALLBACK_COLORS.stops);
});

test('Section height and count are used together: derived bar height disables Max bar height', () => {
  reset();
  let lay = null;
  const p = createMirrorPanel({ doc: document, getLayout: () => lay });
  const count = rowOf(p, 'LED sections (0 = solid, or rows from height)');
  const height = rowOf(p, 'Section height (px) (0 = from count and bar height)');
  const maxH = rowOf(p, 'Max bar height (px)');
  assert.ok(count && height && maxH);
  assert.equal(maxH.querySelector('input').disabled, false);
  S.setMirror('sectionHeight', 20);
  assert.equal(count.querySelector('input').disabled, false);
  assert.equal(maxH.querySelector('input').disabled, false);
  S.setMirror('segments', 20);
  S.setMirror('segmentGap', 0.2);
  assert.equal(count.querySelector('input').disabled, false);
  assert.equal(maxH.querySelector('input').disabled, true);
  assert.equal(maxH.querySelector('output').textContent, '480, from 20 x 20 px');
  lay = { rows: 20, sectionPx: 5.9, room: 142.5, height: 142, derived: true, fit: 0.3 };
  S.setMirror('segments', 21);
  S.setMirror('segments', 20);
  const note = p.el.querySelector('.viz-synth-effective').textContent;
  assert.match(note, /effective: 20 rows x 5.9 px \(room 143 px\)/);
  assert.match(note, /More room: set Visualizer height to Full/);
  lay = { ...lay, sectionPx: 18, fit: 0.9 };
  S.setMirror('segments', 21);
  assert.doesNotMatch(p.el.querySelector('.viz-synth-effective').textContent, /More room/);
  S.setMirror('sectionHeight', 0);
  assert.equal(maxH.querySelector('input').disabled, false);
  assert.equal(height.querySelector('output').textContent, 'From count');
  p.destroy();
});

test('Section aspect derives the bar width from the effective section height and disables Bar width', () => {
  reset();
  let lay = null;
  const p = createMirrorPanel({ doc: document, getLayout: () => lay, getWidth: () => 1200 });
  const aspect = rowOf(p, 'Section width = N x section height (0 = use Bar width)');
  const bw = rowOf(p, 'Bar width (px)');
  assert.ok(aspect && bw);
  assert.equal(S.defaultMirror().sectionAspect, 0);
  assert.equal(aspect.querySelector('output').textContent, 'Off');
  S.setMirror('sectionHeight', 20);
  S.setMirror('segments', 20);
  assert.equal(bw.querySelector('input').disabled, false);
  S.setMirror('sectionAspect', 4);
  assert.equal(bw.querySelector('input').disabled, true);
  assert.equal(bw.querySelector('output').textContent, '80, from 4 x 20 px');
  S.setMirror('gap', 6);
  assert.equal(p.el.querySelector('.viz-synth-count').textContent, '~14 bars');
  lay = { rows: 20, sectionPx: 6, room: 140, height: 168, derived: true, fit: 0.3 };
  S.setMirror('segments', 21);
  S.setMirror('segments', 20);
  assert.equal(bw.querySelector('output').textContent, '24, from 4 x 6 px');
  assert.match(p.el.querySelector('.viz-synth-effective').textContent, /effective: 20 rows x 6 px, width 24 px \(room 140 px\)/);
  assert.equal(p.el.querySelector('.viz-synth-count').textContent, '~40 bars');
  S.setMirror('gap', 11);
  assert.equal(p.el.querySelector('.viz-synth-count').textContent, '~34 bars');
  S.setMirror('sectionHeight', 0);
  assert.equal(bw.querySelector('input').disabled, false);
  S.setMirror('sectionHeight', 20);
  S.setMirror('sectionAspect', 0);
  assert.equal(bw.querySelector('input').disabled, false);
  p.destroy();
});
