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
const P = await import('./viz-mirror-presets.js');
const S = await import('./viz-mirror-settings.js');
const { createMirrorPanel } = await import('./viz-mirror-panel.js');
const fs = await import('node:fs');

const IDS = ['neon-cylinders', 'cyan-magenta-wave', 'neon-blocks', 'pink-cyan-blocks', 'ice-blue-mirror', 'ice-blue-mirror-2', 'classic'];
const ICE_BLUE_FROZEN = {
  barWidth: 10, gap: 2, maxHeight: 175, segments: 20, segmentGap: 0.3, rise: 0.6, fall: 0.15, gradient: 'ice', direction: 'vertical', reflection: 0.8, horizon: true, band: 0.6, backdrop: 'ice',
};
const reset = () => { for (const k of Object.keys(saved)) delete saved[k]; S.resetMirrorForTests(); };

test('seven presets with unique ids and names in order', () => {
  assert.deepEqual(P.MIRROR_PRESET_LIST.map((p) => p.id), IDS);
  assert.equal(new Set(P.MIRROR_PRESET_LIST.map((p) => p.name)).size, 7);
});

test('settings are valid and complete, Classic is the defaults', () => {
  for (const p of P.MIRROR_PRESET_LIST) assert.deepEqual(S.validateMirror(p.settings), p.settings, p.id);
  assert.deepEqual(P.applyMirrorPreset('classic'), S.defaultMirror());
  assert.equal(P.applyMirrorPreset('nope'), null);
});

test('applyMirrorPreset is an independent copy and findActive round-trips', () => {
  const a = P.applyMirrorPreset('neon-blocks');
  a.barWidth = 3;
  assert.equal(P.applyMirrorPreset('neon-blocks').barWidth, 4);
  for (const id of IDS) assert.equal(P.findActiveMirrorPreset(P.applyMirrorPreset(id), id), id);
  const t = P.applyMirrorPreset('ice-blue-mirror');
  t.rise = 0.9;
  assert.equal(P.findActiveMirrorPreset(t), null);
  assert.equal(P.findActiveMirrorPreset(null), null);
});

test('every thumbnail exists as a PNG in web/img/mirror-presets', () => {
  for (const id of IDS) {
    const buf = fs.readFileSync(new URL(`../${P.MIRROR_PRESET_THUMB(id)}`, import.meta.url));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', id);
  }
});

test('panel shows seven preset buttons, click overwrites and highlights, tweak clears', () => {
  reset();
  const p = createMirrorPanel({ doc: document });
  const tiles = p.el.querySelectorAll('button.viz-synth-preset');
  assert.equal(tiles.length, 7);
  for (const t of tiles) assert.match(t.getAttribute('aria-label'), / preset$/);
  const pressed = () => tiles.filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.dataset.preset);
  assert.deepEqual(pressed(), ['classic']);
  tiles.find((t) => t.dataset.preset === 'ice-blue-mirror').click();
  assert.deepEqual(S.getMirror(), P.applyMirrorPreset('ice-blue-mirror'));
  assert.deepEqual(pressed(), ['ice-blue-mirror']);
  assert.equal(JSON.parse(saved[S.MIRROR_KEY]).gradient, 'ice');
  S.setMirror('barWidth', 5);
  assert.deepEqual(pressed(), []);
  p.destroy();
});

test('Ice Blue Mirror is frozen to its liked values', () => {
  assert.deepEqual(P.applyMirrorPreset('ice-blue-mirror'), S.validateMirror({ ...S.defaultMirror(), ...ICE_BLUE_FROZEN }));
  const ice = P.MIRROR_PRESET_LIST.find((p) => p.id === 'ice-blue-mirror');
  for (const [k, v] of Object.entries(ICE_BLUE_FROZEN)) assert.equal(ice.settings[k], v, k);
});

test('Ice Blue Mirror 2 starts as an separate preset, listed after the original', () => {
  const ids = P.MIRROR_PRESET_LIST.map((p) => p.id);
  assert.equal(ids.indexOf('ice-blue-mirror-2'), ids.indexOf('ice-blue-mirror') + 1);
  assert.equal(P.MIRROR_PRESET_LIST[ids.indexOf('ice-blue-mirror-2')].name, 'Ice Blue Mirror 2');
  assert.equal(P.MIRROR_PRESET_THUMB('ice-blue-mirror-2'), 'img/mirror-presets/ice-blue-mirror.png');
});

test('pickActivePreset prefers the preferred id among presets with equal settings', () => {
  const st = { a: 1, b: 2 };
  const list = [{ id: 'one', settings: { ...st } }, { id: 'two', settings: { ...st } }, { id: 'other', settings: { a: 9, b: 2 } }];
  assert.equal(P.pickActivePreset(list, st, 'two'), 'two');
  assert.equal(P.pickActivePreset(list, st, 'one'), 'one');
  assert.equal(P.pickActivePreset(list, st, 'other'), 'one');
  assert.equal(P.pickActivePreset(list, st, 'nope'), 'one');
  assert.equal(P.pickActivePreset(list, st), 'one');
  assert.equal(P.pickActivePreset(list, { a: 0 }, 'one'), null);
});

test('last clicked preset is stored and used as the preference', () => {
  reset();
  P.setLastMirrorPreset('ice-blue-mirror-2');
  assert.equal(saved[P.MIRROR_PRESET_KEY], 'ice-blue-mirror-2');
  assert.equal(P.findActiveMirrorPreset(P.applyMirrorPreset('ice-blue-mirror-2')), 'ice-blue-mirror-2');
  assert.equal(P.findActiveMirrorPreset(P.applyMirrorPreset('ice-blue-mirror')), 'ice-blue-mirror');
});

test('panel marks the clicked ice preset', () => {
  reset();
  const p = createMirrorPanel({ doc: document });
  const tiles = p.el.querySelectorAll('button.viz-synth-preset');
  const pressed = () => tiles.filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.dataset.preset);
  tiles.find((t) => t.dataset.preset === 'ice-blue-mirror-2').click();
  assert.deepEqual(pressed(), ['ice-blue-mirror-2']);
  tiles.find((t) => t.dataset.preset === 'ice-blue-mirror').click();
  assert.deepEqual(pressed(), ['ice-blue-mirror']);
  p.destroy();
});

test('Ice Blue Mirror 2 uses the reverse-engineered LED settings, the original does not', () => {
  const two = P.applyMirrorPreset('ice-blue-mirror-2');
  const one = P.applyMirrorPreset('ice-blue-mirror');
  assert.equal(two.backdrop, 'ice2');
  assert.equal(two.gradient, 'ice2');
  assert.equal(two.sectorMode, 'trail');
  assert.equal(two.peak, 0);
  assert.equal(two.afterimage, 0);
  assert.equal(one.sectorMode, 'off');
  assert.equal(one.gradient, 'ice');
  assert.equal(two.barWidth, 80);
  assert.equal(two.sectionAspect, 4);
  assert.equal(two.sectionHeight, 20);
  assert.equal(two.segments, 20);
  assert.equal(two.segmentGap, 0.4);
  assert.equal(two.maxHeight, 560);
  assert.equal(two.maxHeight, 20 * (20 + 20 * 0.4));
  assert.equal(two.tilt, 0);
  assert.deepEqual([two.window, two.visitsPerStep, two.minDwell, two.maxLevel, two.glow, two.glowSize], [10, 3, 60, 8, 0.8, 1]);
  assert.equal('loss' in two, false);
  assert.equal(two.horizon, false);
  assert.equal(two.band, 0);
  for (const k of ['segments', 'shadeJitter', 'baseGlow', 'mirrorGap']) {
    assert.ok(two[k] !== 0, k);
    assert.equal(one[k], k === 'segments' ? 20 : 0, k);
  }
  assert.equal(one.tilt, 0);
  assert.equal(two.reflectionBlur, 0);
  assert.equal(two.reflectionMode, 'shifted');
  assert.equal(one.reflectionMode, 'alpha');
});

test('fullRoom sets the full-screen overlay span only for Ice Blue Mirror 2', () => {
  const span = (m, mode, h) => S.mirrorSpan(m, mode, h);
  assert.equal(S.defaultMirror().fullRoom, false);
  assert.equal(span(S.defaultMirror(), 'full', 0.6), 0.6);
  assert.equal(span(S.defaultMirror(), 'background', 0.6), 0.6);
  const two = P.applyMirrorPreset('ice-blue-mirror-2');
  assert.equal(two.fullRoom, true);
  assert.equal(span(two, 'full', 0.6), 1);
  assert.equal(span(two, 'background', 0.6), 0.6);
  for (const p of P.MIRROR_PRESET_LIST) if (p.id !== 'ice-blue-mirror-2') assert.equal(p.settings.fullRoom, false, p.id);
  assert.equal(S.validateMirror({ v: 1, fullRoom: 'yes' }).fullRoom, false);
  assert.equal(S.validateMirror({ v: 1, fullRoom: true }).fullRoom, true);
});

test('only Ice Blue Mirror 2 derives the bar width from the section height', () => {
  for (const p of P.MIRROR_PRESET_LIST) assert.equal(p.settings.sectionAspect, p.id === 'ice-blue-mirror-2' ? 4 : 0, p.id);
});
