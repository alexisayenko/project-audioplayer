import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { SYNTH_PRESET_LIST, applyPreset, findActivePreset, PRESET_THUMB } = await import('./viz-synth-presets.js');
const { SYNTH_SCHEMA, validateSynth, defaultSynth } = await import('./viz-synth-settings.js');

const IDS = ['blue-valley', 'teal-dunes', 'neon-peaks', 'violet-plain', 'midnight-grid', 'neon-sea', 'sunset-8bit', 'retro-dusk'];

test('eight presets with unique ids and names in order', () => {
  assert.deepEqual(SYNTH_PRESET_LIST.map((p) => p.id), IDS);
  assert.equal(new Set(SYNTH_PRESET_LIST.map((p) => p.name)).size, 8);
});

test('all settings are valid and complete', () => {
  for (const p of SYNTH_PRESET_LIST) {
    assert.deepEqual(validateSynth(p.settings), p.settings, p.id);
    for (const s of SYNTH_SCHEMA) {
      const i = s.path.indexOf('.');
      assert.notEqual(p.settings[s.path.slice(0, i)][s.path.slice(i + 1)], undefined, `${p.id} ${s.path}`);
    }
  }
});

test('applyPreset returns a full independent overwrite', () => {
  const a = applyPreset('neon-sea');
  assert.deepEqual(Object.keys(a).sort(), ['sky', 'sun', 'terrain']);
  assert.equal(Object.keys(a.sun).length, Object.keys(defaultSynth().sun).length);
  a.sun.height = 3;
  assert.equal(applyPreset('neon-sea').sun.height, 0);
  assert.equal(applyPreset('nope'), null);
});

test('findActivePreset round trip and tweaked detection', () => {
  for (const id of IDS) assert.equal(findActivePreset(applyPreset(id)), id);
  const t = applyPreset('retro-dusk');
  t.sky.horizonV = 0.5;
  assert.equal(findActivePreset(t), null);
  assert.equal(findActivePreset(defaultSynth()), null);
  assert.equal(findActivePreset(null), null);
});

test('sun.height semantics per preset', () => {
  const h = (id) => applyPreset(id).sun.height;
  assert.equal(h('neon-sea'), 0);
  assert.ok(h('midnight-grid') > 1);
  for (const id of ['blue-valley', 'teal-dunes', 'neon-peaks']) assert.ok(h(id) >= 0 && h(id) < 1, id);
  for (const id of ['sunset-8bit', 'violet-plain']) assert.ok(h(id) > 0 && h(id) <= 1, id);
});

test('look constraints from the brief', () => {
  assert.equal(applyPreset('blue-valley').terrain.grid, 'triangle');
  assert.equal(applyPreset('teal-dunes').sun.sliceCount, 0);
  assert.equal(applyPreset('retro-dusk').sky.stars, 0);
  assert.equal(applyPreset('retro-dusk').sun.refl, 'off');
  assert.equal(applyPreset('neon-sea').sun.refl, 'streak');
  assert.equal(applyPreset('sunset-8bit').sun.sliceEdge, 'stepped');
  for (const id of ['midnight-grid', 'neon-sea', 'sunset-8bit', 'retro-dusk']) assert.equal(applyPreset(id).terrain.sharp, 0, id);
  const thick = IDS.map((id) => applyPreset(id).sky.hThick);
  assert.equal(applyPreset('neon-sea').sky.hThick, Math.max(...thick));
  assert.equal(applyPreset('neon-sea').sky.hGlow, 1);
});

test('deferred options are absent', () => {
  for (const p of SYNTH_PRESET_LIST) {
    const keys = Object.keys(p.settings).flatMap((g) => Object.keys(p.settings[g]));
    assert.ok(!keys.some((k) => /skyline|spectrum|pixel|raster|bit8/i.test(k)), p.id);
  }
});

test('thumbnail path', () => {
  assert.equal(PRESET_THUMB('blue-valley'), 'img/synth-presets/blue-valley.png');
});
