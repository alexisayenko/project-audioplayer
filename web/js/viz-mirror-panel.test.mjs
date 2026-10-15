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
  const input = rowOf(p, 'Bar width').querySelector('input');
  input.value = '0.8';
  fire(input, 'input');
  assert.equal(S.getMirror().width, 0.8);
  assert.equal(JSON.parse(saved[S.MIRROR_KEY]).width, 0.8);
  const sw = rowOf(p, 'Horizon glow').querySelector('input');
  sw.checked = false;
  fire(sw, 'change');
  assert.equal(S.getMirror().horizon, false);
  p.el.querySelector('.viz-synth-reset-all').click();
  assert.deepEqual(S.getMirror(), S.defaultMirror());
  assert.equal(input.value, '0.6');
  p.destroy();
});

test('group reset only touches its group', () => {
  reset();
  S.setMirror('width', 0.9);
  S.setMirror('rise', 0.3);
  S.resetMirror('Bars');
  assert.equal(S.getMirror().width, 0.6);
  assert.equal(S.getMirror().rise, 0.3);
});

test('invalid stored data repairs to defaults', () => {
  reset();
  saved[S.MIRROR_KEY] = JSON.stringify({ v: 1, width: 9, gradient: 'nope', horizon: 'x', fall: 0.2 });
  const m = S.getMirror();
  assert.equal(m.width, 0.95);
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
