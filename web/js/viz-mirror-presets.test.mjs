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

const IDS = ['neon-cylinders', 'cyan-magenta-wave', 'neon-blocks', 'pink-cyan-blocks', 'ice-blue-mirror', 'classic'];
const reset = () => { for (const k of Object.keys(saved)) delete saved[k]; S.resetMirrorForTests(); };

test('six presets with unique ids and names in order', () => {
  assert.deepEqual(P.MIRROR_PRESET_LIST.map((p) => p.id), IDS);
  assert.equal(new Set(P.MIRROR_PRESET_LIST.map((p) => p.name)).size, 6);
});

test('settings are valid and complete, Classic is the defaults', () => {
  for (const p of P.MIRROR_PRESET_LIST) assert.deepEqual(S.validateMirror(p.settings), p.settings, p.id);
  assert.deepEqual(P.applyMirrorPreset('classic'), S.defaultMirror());
  assert.equal(P.applyMirrorPreset('nope'), null);
});

test('applyMirrorPreset is an independent copy and findActive round-trips', () => {
  const a = P.applyMirrorPreset('neon-blocks');
  a.width = 0.3;
  assert.equal(P.applyMirrorPreset('neon-blocks').width, 0.8);
  for (const id of IDS) assert.equal(P.findActiveMirrorPreset(P.applyMirrorPreset(id)), id);
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

test('panel shows six preset buttons, click overwrites and highlights, tweak clears', () => {
  reset();
  const p = createMirrorPanel({ doc: document });
  const tiles = p.el.querySelectorAll('button.viz-synth-preset');
  assert.equal(tiles.length, 6);
  for (const t of tiles) assert.match(t.getAttribute('aria-label'), / preset$/);
  const pressed = () => tiles.filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.dataset.preset);
  assert.deepEqual(pressed(), ['classic']);
  tiles.find((t) => t.dataset.preset === 'ice-blue-mirror').click();
  assert.deepEqual(S.getMirror(), P.applyMirrorPreset('ice-blue-mirror'));
  assert.deepEqual(pressed(), ['ice-blue-mirror']);
  assert.equal(JSON.parse(saved[S.MIRROR_KEY]).gradient, 'accent');
  S.setMirror('width', 0.5);
  assert.deepEqual(pressed(), []);
  p.destroy();
});
