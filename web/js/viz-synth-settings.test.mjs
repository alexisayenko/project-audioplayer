import { test } from 'node:test';
import assert from 'node:assert/strict';

const saved = {};
globalThis.localStorage = {
  getItem: (k) => (k in saved ? saved[k] : null),
  setItem: (k, v) => { saved[k] = String(v); },
  removeItem: (k) => { delete saved[k]; },
};
const m = await import('./viz-synth-settings.js');
const {
  SYNTH_KEY, SYNTH_SCHEMA, SYNTH_PRESETS, defaultSynth, validateSynth, getSynth, setSynth, applyPreset, resetSynth, onSynth, synthVersion, parseHex, resetSynthForTests,
} = m;

const fresh = () => { for (const k of Object.keys(saved)) delete saved[k]; resetSynthForTests(); };
const pathOf = (s, p) => { const i = p.indexOf('.'); return s[p.slice(0, i)][p.slice(i + 1)]; };

test('defaults match the contract table', () => {
  const d = defaultSynth();
  assert.equal(d.terrain.preset, 'cyan');
  assert.equal(d.terrain.eye, 2.6);
  assert.equal(d.terrain.lineColor, '#2ee6ff');
  assert.equal(d.terrain.valley, true);
  assert.equal(d.terrain.hills, false);
  assert.equal(d.sun.radius, 0.22);
  assert.equal(d.sun.sliceCount, 7);
  assert.equal(d.sun.sliceGrowth, 1.45);
  assert.equal(d.sun.refl, 'streak');
  assert.equal(d.sky.horizonV, 0.4);
  assert.equal(d.sky.stars, 140);
  assert.equal(d.sky.starSeed, 7);
  assert.equal(d.sky.hBand, false);
  assert.deepEqual(Object.keys(d), ['terrain', 'sun', 'sky']);
  assert.equal(Object.keys(d.terrain).length + Object.keys(d.sun).length + Object.keys(d.sky).length, SYNTH_SCHEMA.length);
});

test('schema paths are unique, defaults valid, groups in the documented set', () => {
  const paths = new Set();
  const groups = new Set(['Terrain', 'Peaks', 'Sun', 'Haze', 'Reflection', 'Horizon', 'Sky']);
  for (const s of SYNTH_SCHEMA) {
    assert.ok(!paths.has(s.path), s.path);
    paths.add(s.path);
    assert.ok(groups.has(s.group), s.group);
    assert.ok(['range', 'select', 'bool', 'color', 'int'].includes(s.type));
    if (s.type === 'range' || s.type === 'int') assert.ok(s.def >= s.min && s.def <= s.max, s.path);
    if (s.type === 'select') assert.ok(s.options.includes(s.def), s.path);
  }
  assert.deepEqual(validateSynth(defaultSynth()), defaultSynth());
});

test('every field is repaired from garbage', () => {
  const garbage = [null, undefined, NaN, Infinity, 'x', {}, [], true, -1e9, 1e9, '#12', '#GGGGGG', 12];
  for (const s of SYNTH_SCHEMA) {
    for (const g of garbage) {
      const [grp, key] = s.path.split('.');
      const out = validateSynth({ [grp]: { [key]: g } });
      const v = pathOf(out, s.path);
      if (s.type === 'range' || s.type === 'int') {
        assert.ok(Number.isFinite(v) && v >= s.min && v <= s.max, `${s.path} ${String(g)} -> ${v}`);
        if (s.type === 'int') assert.equal(v, Math.round(v));
      } else if (s.type === 'select') assert.ok(s.options.includes(v));
      else if (s.type === 'bool') assert.equal(typeof v, 'boolean');
      else assert.match(v, /^#[0-9a-f]{6}$/);
    }
  }
});

test('numbers clamp, colours lowercase, enums fall back', () => {
  const o = validateSynth({ sun: { radius: 5, sliceCount: 3.6, top: '#FFAA00', refl: 'nope' }, terrain: { speed: -3 }, sky: { stars: 9999 } });
  assert.equal(o.sun.radius, 0.6);
  assert.equal(o.sun.sliceCount, 4);
  assert.equal(o.sun.top, '#ffaa00');
  assert.equal(o.sun.refl, 'streak');
  assert.equal(o.terrain.speed, 0.2);
  assert.equal(o.sky.stars, 600);
});

test('unknown keys are dropped; bad text, wrong version and non-objects give defaults', () => {
  const o = validateSynth({ v: 1, evil: 1, sun: { radius: 0.3, bogus: 2 }, other: {} });
  assert.equal(o.sun.radius, 0.3);
  assert.equal('bogus' in o.sun, false);
  assert.equal('evil' in o, false);
  assert.deepEqual(validateSynth('{not json'), defaultSynth());
  assert.deepEqual(validateSynth('null'), defaultSynth());
  assert.deepEqual(validateSynth(JSON.stringify({ v: 2, sun: { radius: 0.3 } })), defaultSynth());
  assert.deepEqual(validateSynth(7), defaultSynth());
  assert.deepEqual(validateSynth([1]), defaultSynth());
  assert.equal(validateSynth('{"sun":{"radius":0.31}}').sun.radius, 0.31);
});

test('set persists, round-trips through storage, bumps the version and notifies once per change', () => {
  fresh();
  const seen = [];
  const off = onSynth((s, p) => seen.push(p));
  const v0 = synthVersion();
  assert.equal(setSynth('sun.radius', 0.3), 0.3);
  assert.equal(getSynth().sun.radius, 0.3);
  assert.equal(synthVersion(), v0 + 1);
  assert.deepEqual(seen, ['sun.radius']);
  setSynth('sun.radius', 0.3);
  assert.equal(synthVersion(), v0 + 1);
  assert.equal(JSON.parse(saved[SYNTH_KEY]).v, 1);
  resetSynthForTests();
  assert.equal(getSynth().sun.radius, 0.3);
  off();
  setSynth('sun.radius', 0.4);
  assert.equal(seen.length, 1);
});

test('setSynth repairs a single bad value and ignores unknown paths', () => {
  fresh();
  assert.equal(setSynth('sun.radius', 99), 0.6);
  assert.equal(setSynth('sun.refl', 'zzz'), 'streak');
  assert.equal(setSynth('nope.x', 1), undefined);
  assert.equal(setSynth('sun.nope', 1), undefined);
  assert.equal(getSynth().sun.radius, 0.6);
});

test('getSynth keeps group identity for untouched groups', () => {
  fresh();
  const a = getSynth();
  setSynth('sun.radius', 0.3);
  const b = getSynth();
  assert.notEqual(a, b);
  assert.equal(a.terrain, b.terrain);
  assert.equal(a.sky, b.sky);
  assert.notEqual(a.sun, b.sun);
});

test('storage errors are swallowed', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  resetSynthForTests();
  assert.deepEqual(getSynth(), defaultSynth());
  assert.doesNotThrow(() => setSynth('sun.radius', 0.3));
  globalThis.localStorage = real;
});

test('selecting a preset overwrites the four colours; editing a colour sets custom', () => {
  fresh();
  applyPreset('pink');
  let s = getSynth();
  assert.equal(s.terrain.preset, 'pink');
  assert.equal(s.terrain.lineColor, SYNTH_PRESETS.pink.lineColor);
  assert.equal(s.terrain.fillColor, SYNTH_PRESETS.pink.fillColor);
  assert.equal(s.terrain.faceColor, SYNTH_PRESETS.pink.faceColor);
  assert.equal(s.sky.hColor, SYNTH_PRESETS.pink.hColor);
  setSynth('terrain.preset', 'blue');
  assert.equal(getSynth().terrain.lineColor, '#3d7bff');
  assert.equal(getSynth().terrain.fillColor, '#dfe9ff');
  setSynth('terrain.lineColor', '#123456');
  s = getSynth();
  assert.equal(s.terrain.preset, 'custom');
  assert.equal(s.terrain.lineColor, '#123456');
  setSynth('sky.hColor', '#654321');
  assert.equal(getSynth().terrain.preset, 'custom');
  setSynth('terrain.preset', 'custom');
  assert.equal(getSynth().terrain.lineColor, '#123456');
  assert.equal(applyPreset('nope'), false);
  const v = synthVersion();
  applyPreset('custom');
  assert.equal(synthVersion(), v);
});

test('the cyan preset equals the defaults', () => {
  fresh();
  applyPreset('blue');
  applyPreset('cyan');
  assert.deepEqual(getSynth(), defaultSynth());
});

test('reset by group and all', () => {
  fresh();
  setSynth('sun.radius', 0.3);
  setSynth('sky.stars', 10);
  setSynth('terrain.speed', 2);
  resetSynth('Sun');
  assert.equal(getSynth().sun.radius, 0.22);
  assert.equal(getSynth().sky.stars, 10);
  assert.equal(getSynth().terrain.speed, 2);
  const v = synthVersion();
  resetSynth('Sun');
  assert.equal(synthVersion(), v);
  resetSynth();
  assert.deepEqual(getSynth(), defaultSynth());
});

test('parseHex returns floats and zeros for junk', () => {
  assert.deepEqual(parseHex('#ff0000'), [1, 0, 0]);
  assert.deepEqual(parseHex('#000000'), [0, 0, 0]);
  const [r, g, b] = parseHex('#2ee6ff');
  assert.ok(Math.abs(r - 46 / 255) < 1e-9 && Math.abs(g - 230 / 255) < 1e-9 && b === 1);
  assert.deepEqual(parseHex('red'), [0, 0, 0]);
  assert.deepEqual(parseHex(null), [0, 0, 0]);
});

test('sun height is clamped to -1..3 and an old saved lift key is ignored', () => {
  assert.equal(validateSynth({ sun: { height: 9 } }).sun.height, 3);
  assert.equal(validateSynth({ sun: { height: -9 } }).sun.height, -1);
  assert.equal(validateSynth({ sun: { height: 'x' } }).sun.height, 0.5);
  const o = validateSynth({ sun: { lift: 0.9 } });
  assert.equal(o.sun.height, 0.5);
  assert.ok(!('lift' in o.sun));
});
