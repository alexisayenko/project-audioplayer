import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSynth } from './viz-synth-gl.js';
import { defaultSynth } from './viz-synth-settings.js';

function fakeGL() {
  const calls = [];
  const consts = new Map();
  return new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      return (...args) => { calls.push([name, ...args]); return undefined; };
    },
  });
}

function fakeCanvas() {
  const handlers = {};
  return {
    width: 300,
    height: 150,
    handlers,
    addEventListener(n, f) { handlers[n] = f; },
    removeEventListener(n) { delete handlers[n]; },
    getContext() { return null; },
  };
}

function rig({ fail = null } = {}) {
  const log = [];
  const made = {};
  const mk = (name, methods) => (gl, deps) => {
    if (fail === name) throw new Error(`${name} boom`);
    const p = { name, deps, disposed: 0, rebuilt: 0, sizes: [], by: {} };
    for (const m of methods) p[m] = (...a) => { log.push(`${name}.${m}`); p.last = a; p.by[m] = a; };
    p.dispose = () => { p.disposed += 1; log.push(`${name}.dispose`); };
    p.rebuild = () => { p.rebuilt += 1; log.push(`${name}.rebuild`); };
    p.resize = (...a) => { p.sizes.push(a); };
    made[name] = p;
    return p;
  };
  const passes = {
    sky: mk('sky', ['drawBack', 'drawFront']),
    sun: mk('sun', ['drawHaze', 'drawSun', 'drawReflection']),
    ground: mk('ground', ['setHeights', 'drawHills', 'drawFloor', 'drawTerrain']),
  };
  return { log, made, passes };
}

const spec = new Array(64).fill(0.5);
const make = (o = {}) => {
  const r = rig(o.rig);
  const gl = fakeGL();
  const canvas = fakeCanvas();
  const settings = o.settings ?? defaultSynth();
  const synth = createSynth(canvas, { gl, passes: r.passes, settings: () => settings, reduced: o.reduced ?? false, quality: o.quality ?? 2, onError: o.onError });
  return { ...r, gl, canvas, synth, settings };
};

test('createSynth returns null without a WebGL context', () => {
  assert.equal(createSynth(fakeCanvas(), { passes: rig().passes }), null);
});

test('passes are created in order with linkProgram and sized to css pixels', () => {
  const t = make();
  assert.deepEqual(Object.keys(t.made), ['sky', 'sun', 'ground']);
  for (const p of Object.values(t.made)) assert.equal(typeof p.deps.linkProgram, 'function');
  t.synth.resize(400, 200, 2);
  assert.deepEqual(t.made.sky.sizes.at(-1), [400, 200, 1.5]);
  assert.equal(t.canvas.width, 600);
  assert.equal(t.canvas.height, 300);
});

test('draw clears then runs the passes in the section 4 order after the heights upload', () => {
  const t = make();
  t.synth.resize(400, 200, 1);
  t.synth.draw(spec, 1000, null, 0);
  const wanted = ['sky.drawBack', 'sun.drawHaze', 'sun.drawSun', 'ground.drawHills', 'ground.drawFloor', 'sun.drawReflection', 'ground.drawTerrain', 'sky.drawFront'];
  const order = t.log.filter((l) => wanted.includes(l));
  assert.deepEqual(order, wanted);
  assert.ok(t.log.indexOf('ground.setHeights') < t.log.indexOf('ground.drawHills'));
  const names = t.gl.calls.map((c) => c[0]);
  assert.ok(names.includes('clear'));
  assert.ok(names.indexOf('clear') > names.lastIndexOf('viewport') - 1 && names.indexOf('viewport') < names.indexOf('clear'));
  const clear = t.gl.calls.find((c) => c[0] === 'clearColor');
  const bottom = t.settings.sky.bottom;
  assert.ok(Math.abs(clear[1] - parseInt(bottom.slice(1, 3), 16) / 255) < 1e-9);
});

test('params: sky and ground get the whole settings, sun gets settings.sun', () => {
  const t = make();
  t.synth.resize(400, 200, 1);
  t.synth.draw(spec, 1000);
  assert.equal(t.made.sky.last[1], t.settings);
  assert.equal(t.made.sun.last[1], t.settings.sun);
  assert.equal(t.made.ground.last[1], t.settings);
});

test('scene carries css size, device res, horizon, time, quality and signal in range', () => {
  const t = make();
  t.synth.resize(400, 200, 2);
  t.synth.draw(spec, 2500);
  const [scene, , signal] = t.made.sky.last;
  assert.equal(scene.w, 400);
  assert.equal(scene.h, 200);
  assert.equal(scene.dpr, 1.5);
  assert.deepEqual(scene.res, [600, 300]);
  assert.equal(scene.horizonV, 0.4);
  assert.equal(scene.aspect, 2);
  assert.equal(scene.reduced, false);
  assert.ok(Math.abs(scene.time - 2.5) < 1e-9);
  assert.equal(scene.q.level, 2);
  for (const k of ['bass', 'energy', 'pulse', 'flash']) assert.ok(signal[k] >= 0 && signal[k] <= 1);
});

test('setHeights gets a field sized from the grid with finite capped heights', () => {
  const t = make();
  t.synth.resize(400, 200, 1);
  for (let i = 0; i < 20; i += 1) t.synth.draw(spec, 1000 + i * 70);
  const st = t.made.ground.by.setHeights[0];
  assert.ok(t.made.ground.by.setHeights[1] >= 0);
  assert.ok(st.hw > 0);
  assert.equal(st.data.length, st.rows * st.cols);
  let max = 0;
  for (const h of st.data) { assert.ok(Number.isFinite(h)); max = Math.max(max, h); }
  assert.ok(max > 0 && max <= 4.5 + 1e-6);
  assert.ok(st.dz > 0);
  assert.ok(st.future === null || st.future.length % st.cols === 0);
});

test('spectrum null and bad time do not throw', () => {
  const t = make();
  t.synth.resize(100, 100, 1);
  assert.doesNotThrow(() => { t.synth.draw(null, NaN); t.synth.draw(undefined, 5, null, NaN); });
});

test('settings changes reach the passes on the next frame', () => {
  const t = make();
  t.synth.resize(400, 200, 1);
  t.synth.draw(spec, 1000);
  const next = { ...t.settings, sky: { ...t.settings.sky, horizonV: 0.5 } };
  t.settings = next;
  const r = rig();
  const synth = createSynth(fakeCanvas(), { gl: fakeGL(), passes: r.passes, settings: () => next, reduced: false });
  synth.resize(100, 100, 1);
  synth.draw(spec, 10);
  assert.equal(r.made.sky.last[0].horizonV, 0.5);
});

test('context loss stops drawing and restore rebuilds every pass', () => {
  const t = make();
  t.synth.resize(400, 200, 1);
  t.synth.draw(spec, 1000);
  const prevented = [];
  t.canvas.handlers.webglcontextlost({ preventDefault: () => prevented.push(1) });
  assert.equal(prevented.length, 1);
  assert.equal(t.synth.lost, true);
  const n = t.log.length;
  t.synth.draw(spec, 1100);
  assert.equal(t.log.length, n);
  t.canvas.handlers.webglcontextrestored();
  assert.equal(t.synth.lost, false);
  for (const p of Object.values(t.made)) assert.equal(p.rebuilt, 1);
  t.synth.draw(spec, 1200);
  assert.ok(t.log.length > n);
});

test('a failing rebuild reports the error and stays lost', () => {
  const errs = [];
  const t = make({ onError: (e) => errs.push(e) });
  t.canvas.handlers.webglcontextlost({});
  t.made.sun.rebuild = () => { throw new Error('nope'); };
  t.canvas.handlers.webglcontextrestored();
  assert.equal(errs.length, 1);
  assert.equal(t.synth.lost, true);
});

test('dispose frees every pass once, removes listeners and stops drawing', () => {
  const t = make();
  t.synth.resize(100, 100, 1);
  t.synth.dispose();
  t.synth.dispose();
  for (const p of Object.values(t.made)) assert.equal(p.disposed, 1);
  assert.deepEqual(Object.keys(t.canvas.handlers), []);
  const n = t.log.length;
  t.synth.draw(spec, 1);
  assert.equal(t.log.length, n);
});

test('dispose after a lost context does not touch dead GL objects', () => {
  const t = make();
  t.canvas.handlers.webglcontextlost({});
  t.synth.dispose();
  for (const p of Object.values(t.made)) assert.equal(p.disposed, 0);
});

test('a pass factory that throws gives null, reports the error and frees the earlier passes', () => {
  const errs = [];
  const r = rig({ fail: 'ground' });
  const out = createSynth(fakeCanvas(), { gl: fakeGL(), passes: r.passes, onError: (e) => errs.push(e.message) });
  assert.equal(out, null);
  assert.deepEqual(errs, ['ground boom']);
  assert.equal(r.made.sky.disposed, 1);
  assert.equal(r.made.sun.disposed, 1);
});

test('reduced motion draws one static frame with time 0 until something changes', () => {
  const t = make({ reduced: true });
  t.synth.resize(400, 200, 1);
  t.synth.draw(spec, 1000);
  const first = t.log.filter((l) => l === 'ground.drawTerrain').length;
  assert.equal(first, 1);
  const scene = t.made.sky.last[0];
  assert.equal(scene.time, 0);
  assert.equal(scene.reduced, true);
  assert.deepEqual({ ...t.made.sky.last[2] }, { bass: 0.3, energy: 0.3, pulse: 0.3, flash: 0.3 });
  t.synth.draw(spec, 2000);
  t.synth.draw(spec, 3000);
  assert.equal(t.log.filter((l) => l === 'ground.drawTerrain').length, 1);
  t.synth.resize(500, 200, 1);
  t.synth.draw(spec, 4000);
  assert.equal(t.log.filter((l) => l === 'ground.drawTerrain').length, 2);
  t.settings = { ...t.settings };
  t.synth.setQuality(1);
  t.synth.draw(spec, 5000);
  assert.equal(t.log.filter((l) => l === 'ground.drawTerrain').length, 3);
  t.synth.setLite(true);
  t.synth.draw(spec, 6000);
  assert.equal(t.log.filter((l) => l === 'ground.drawTerrain').length, 4);
});

test('reduced motion redraws on a settings change', () => {
  let settings = defaultSynth();
  const r = rig();
  const synth = createSynth(fakeCanvas(), { gl: fakeGL(), passes: r.passes, settings: () => settings, reduced: true });
  synth.resize(100, 100, 1);
  synth.draw(spec, 0);
  synth.draw(spec, 10);
  assert.equal(r.log.filter((l) => l === 'ground.drawTerrain').length, 1);
  settings = { ...settings, sun: { ...settings.sun, radius: 0.3 } };
  synth.draw(spec, 20);
  assert.equal(r.log.filter((l) => l === 'ground.drawTerrain').length, 2);
});

test('the reduced-motion media query is honoured and followed live', () => {
  const listeners = [];
  const mq = { matches: true, addEventListener: (n, f) => listeners.push(f), removeEventListener: () => {} };
  globalThis.matchMedia = () => mq;
  try {
    const r = rig();
    const synth = createSynth(fakeCanvas(), { gl: fakeGL(), passes: r.passes, settings: defaultSynthGetter });
    synth.resize(100, 100, 1);
    synth.draw(spec, 100);
    synth.draw(spec, 200);
    assert.equal(r.log.filter((l) => l === 'ground.drawTerrain').length, 1);
    listeners[0]({ matches: false });
    synth.draw(spec, 300);
    synth.draw(spec, 400);
    assert.equal(r.log.filter((l) => l === 'ground.drawTerrain').length, 3);
  } finally {
    delete globalThis.matchMedia;
  }
});
const shared = defaultSynth();
function defaultSynthGetter() { return shared; }

test('dpr is capped at 1.5, 2 only with the hi cap at level 2, 1 at level 0', () => {
  const t = make({ quality: 2 });
  t.synth.resize(100, 100, 3);
  assert.equal(t.canvas.width, 150);
  t.synth.setDprCap(true);
  assert.equal(t.canvas.width, 200);
  assert.equal(t.synth.stats.dpr, 2);
  t.synth.setDprCap(false);
  assert.equal(t.canvas.width, 150);
  t.synth.setQuality(0);
  assert.equal(t.canvas.width, 100);
  assert.equal(t.synth.quality, 0);
});

test('lite and quality reach the scene flags', () => {
  const t = make({ quality: 2 });
  t.synth.resize(100, 100, 1);
  t.synth.setLite(true);
  t.synth.draw(spec, 100);
  const q = t.made.sky.last[0].q;
  assert.equal(q.starsAnimated, false);
  assert.equal(q.glowPasses, 0);
  assert.equal(t.synth.stats.lite, true);
  t.synth.setQuality(0);
  t.synth.draw(spec, 200);
  assert.equal(t.made.sky.last[0].q.cellMul, 2);
});

test('stats has the createTerrain keys', () => {
  const t = make();
  t.synth.resize(320, 180, 1);
  const s = t.synth.stats;
  for (const k of ['level', 'tiers', 'vertices', 'dpr', 'lite', 'w', 'h', 'builds']) assert.ok(k in s, k);
  assert.equal(s.w, 320);
  assert.equal(s.h, 180);
  assert.equal(s.builds, 1);
});

test('look-ahead timelines are accepted and blended without throwing', () => {
  const t = make();
  t.synth.resize(200, 100, 1);
  const tl = { done: 0, ver: 1, rows: 0, bins: 64 };
  assert.doesNotThrow(() => t.synth.draw(spec, 1000, { timeline: null, time: 0, partial: false }, 0.05));
  assert.ok(tl);
});

function linkingGL() {
  const base = fakeGL();
  return new Proxy(base, {
    get(t, name) {
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getUniformLocation') return (_p, n) => ({ name: n });
      if (typeof name === 'string' && name.startsWith('create')) return () => ({ kind: name });
      return t[name];
    },
  });
}

test('the real passes compose under a fake GL: programs linked, all passes draw, dispose is clean', () => {
  const gl = linkingGL();
  const canvas = fakeCanvas();
  const synth = createSynth(canvas, { gl, reduced: false, settings: () => shared, quality: 2 });
  assert.ok(synth);
  synth.resize(640, 360, 1);
  for (let i = 0; i < 12; i += 1) synth.draw(spec, 1000 + i * 70);
  const names = gl.calls.map((c) => c[0]);
  assert.ok(names.includes('drawArrays'));
  assert.ok(names.includes('drawElements'));
  assert.ok(synth.stats.tiers > 0);
  assert.ok(synth.stats.vertices > 0);
  synth.setQuality(0);
  synth.setLite(true);
  synth.draw(spec, 5000);
  synth.dispose();
  assert.ok(gl.calls.filter((c) => c[0] === 'deleteProgram').length >= 8);
});

test('the real passes survive context loss and restore under a fake GL', () => {
  const gl = linkingGL();
  const canvas = fakeCanvas();
  const synth = createSynth(canvas, { gl, reduced: false, settings: () => shared });
  synth.resize(320, 180, 1);
  synth.draw(spec, 1000);
  canvas.handlers.webglcontextlost({});
  canvas.handlers.webglcontextrestored();
  assert.equal(synth.lost, false);
  assert.doesNotThrow(() => synth.draw(spec, 1100));
});

test('a context that is never restored reports an error after the timeout', async (t) => {
  const errs = [];
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
  t.mock.method(globalThis, 'clearTimeout', (id) => { timers[id - 1].off = true; });
  const x = make({ onError: (e) => errs.push(e.message) });
  x.canvas.handlers.webglcontextlost({});
  assert.equal(errs.length, 0);
  timers.filter((m) => !m.off).forEach((m) => m.fn());
  assert.equal(errs.length, 1);
});

test('a restored context cancels the restore timeout', (t) => {
  const errs = [];
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => { timers.push({ fn }); return timers.length; });
  t.mock.method(globalThis, 'clearTimeout', (id) => { timers[id - 1].off = true; });
  const x = make({ onError: (e) => errs.push(e) });
  x.canvas.handlers.webglcontextlost({});
  x.canvas.handlers.webglcontextrestored();
  timers.filter((m) => !m.off).forEach((m) => m.fn());
  assert.equal(errs.length, 0);
});
