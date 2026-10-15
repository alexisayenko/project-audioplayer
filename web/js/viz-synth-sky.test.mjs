import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skyColors, starField, twinkleAt, skyUniforms, horizonUniforms, vignetteUniforms, createSkyPass,
  SKY_FS, STAR_VS, HORIZON_FS, VIGNETTE_FS,
} from './viz-synth-sky.js';
import { linkProgram } from './viz-terrain-gl.js';

const SKY = {
  horizonV: 0.4, top: '#05021a', mid: '#1a0a4a', bottom: '#5a1a7a', midOn: true,
  stars: 140, starSize: 1.2, starBright: 0.7, twinkle: 0.4, starSeed: 7,
  vignette: true, vignetteAmount: 0.45,
  hColor: '#ff4fd8', hThick: 1.5, hGlow: 0.7, hSpread: 0.04, hSoft: 0.3,
  hBand: false, hBandColor: '#3b6bff', hBandHeight: 0.02,
};
const SUN = { bandOn: true, bandColor: '#ff3d8a' };
const scene = (over = {}) => ({
  w: 1280, h: 720, dpr: 1.5, aspect: 1280 / 720, res: [1920, 1080], horizonV: 0.4, time: 3, dt: 0.016, reduced: false,
  q: { starsAnimated: true }, ...over,
});
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('skyColors: stops, horizon equals bottom, fog mixes the haze band', () => {
  const c = skyColors(SKY, SUN);
  near(c.top[2], 0x1a / 255);
  assert.deepEqual(c.horizon, c.bottom);
  const band = [0xff / 255, 0x3d / 255, 0x8a / 255];
  for (let i = 0; i < 3; i += 1) near(c.fog[i], (c.bottom[i] + band[i]) / 2);
  assert.deepEqual(skyColors(SKY, { bandOn: false, bandColor: '#ff3d8a' }).fog, c.bottom);
  assert.deepEqual(skyColors(SKY).fog, c.bottom);
});

test('skyColors: midOn false interpolates the mid stop', () => {
  const c = skyColors({ ...SKY, midOn: false }, SUN);
  for (let i = 0; i < 3; i += 1) near(c.mid[i], (c.top[i] + c.bottom[i]) / 2);
});

test('starField: deterministic per seed, above the horizon, count scales with area', () => {
  const a = starField(SKY, 1280, 720);
  const b = starField(SKY, 1280, 720);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(a.length, 140 * 5);
  for (let i = 0; i < 140; i += 1) {
    assert.ok(a[i * 5] >= 0 && a[i * 5] <= 1280);
    assert.ok(a[i * 5 + 1] >= 0 && a[i * 5 + 1] < 0.4 * 720);
    assert.ok(a[i * 5 + 2] > 0);
    assert.ok(a[i * 5 + 4] > 0 && a[i * 5 + 4] <= 1);
  }
  assert.notDeepEqual(Array.from(a), Array.from(starField({ ...SKY, starSeed: 8 }, 1280, 720)));
  assert.equal(starField(SKY, 640, 360).length, 35 * 5);
  assert.equal(starField(SKY, 4000, 3000).length, 140 * 5);
  assert.equal(starField({ ...SKY, stars: 0 }, 1280, 720).length, 0);
});

test('twinkleAt: bounded, flat when not animated or reduced', () => {
  for (let t = 0; t < 10; t += 0.37) {
    const v = twinkleAt(1.1, t, 0.4, { starsAnimated: true });
    assert.ok(v >= 0.6 - 1e-9 && v <= 1 + 1e-9);
  }
  assert.equal(twinkleAt(1, 5, 0.4, { starsAnimated: false }), 1);
  assert.equal(twinkleAt(1, 5, 0.4, { starsAnimated: true, reduced: true }), 1);
  assert.equal(twinkleAt(1, 5, 0, { starsAnimated: true }), 1);
  assert.equal(twinkleAt(1, 5, 0.4, undefined), 1);
});

test('skyUniforms: twinkle off when not animated or reduced; time frozen when reduced', () => {
  assert.equal(skyUniforms(scene(), SKY, null).twinkle, 0.4);
  assert.equal(skyUniforms(scene({ q: { starsAnimated: false } }), SKY, null).twinkle, 0);
  const r = skyUniforms(scene({ reduced: true, time: 0 }), SKY, null);
  assert.equal(r.twinkle, 0);
  assert.equal(r.time, 0);
  near(skyUniforms(scene(), SKY, null).starSizePx, 1.8);
});

test('uniform builders reuse the out object and ignore the signal', () => {
  const out = {};
  const a = skyUniforms(scene(), SKY, { flash: 0 }, out);
  assert.equal(a, out);
  const top = out.top;
  const b = skyUniforms(scene(), SKY, { flash: 1 }, out);
  assert.equal(b.top, top);
  const h0 = horizonUniforms(scene(), SKY, { flash: 0 });
  const h1 = horizonUniforms(scene(), SKY, { flash: 1 });
  assert.deepEqual(h0, h1);
});

test('horizonUniforms: pixel units and band', () => {
  const u = horizonUniforms(scene(), SKY, null);
  near(u.horizonY, 0.4 * 1080);
  near(u.thickPx, 2.25);
  near(u.spreadPx, 0.04 * 1080);
  assert.equal(u.bandOn, 0);
  assert.equal(u.bandPx, 0);
  const b = horizonUniforms(scene(), { ...SKY, hBand: true }, null);
  assert.equal(b.bandOn, 1);
  near(b.bandPx, 0.02 * 1080);
});

test('vignetteUniforms: amount zero when off', () => {
  assert.equal(vignetteUniforms(scene(), SKY).amount, 0.45);
  assert.equal(vignetteUniforms(scene(), { ...SKY, vignette: false }).amount, 0);
});

test('shader sources declare the uniforms the passes set', () => {
  for (const n of ['u_res', 'u_horizonV', 'u_top', 'u_mid', 'u_bottom']) assert.ok(SKY_FS.includes(n));
  for (const n of ['u_css', 'u_twinkle', 'u_time', 'u_bright', 'u_dpr']) assert.ok(STAR_VS.includes(n));
  for (const n of ['u_horizonY', 'u_thickPx', 'u_glow', 'u_color', 'u_bandColor']) assert.ok(HORIZON_FS.includes(n));
  for (const n of ['u_amount', 'u_aspect']) assert.ok(VIGNETTE_FS.includes(n));
});

function fakeGL() {
  const calls = [];
  const live = new Set();
  const consts = new Map();
  return new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (name === 'live') return live;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      return (...args) => {
        calls.push([name, ...args]);
        if (name.startsWith('create')) { const o = { kind: name.slice(6) }; live.add(o); return o; }
        if (name.startsWith('delete')) { live.delete(args[0]); return undefined; }
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'getUniformLocation') return { name: args[1] };
        return undefined;
      };
    },
  });
}

const count = (gl, n) => gl.calls.filter((c) => c[0] === n).length;
const settings = () => ({ sky: SKY, sun: SUN });

test('createSkyPass: draws back then front, uploads stars once, skips unchanged uniforms', () => {
  const gl = fakeGL();
  const pass = createSkyPass(gl, { linkProgram });
  pass.resize(1280, 720, 1.5);
  const sc = scene();
  pass.drawBack(sc, settings(), null);
  assert.equal(count(gl, 'drawArrays'), 2);
  assert.equal(pass.stats.starCount, 140);
  assert.equal(pass.stats.uploads, 1);
  const uniformCalls = gl.calls.filter((c) => c[0].startsWith('uniform')).length;
  pass.drawBack(sc, settings(), null);
  assert.equal(pass.stats.uploads, 1);
  assert.equal(gl.calls.filter((c) => c[0].startsWith('uniform')).length, uniformCalls);
  const before = count(gl, 'drawArrays');
  pass.drawFront(sc, settings(), null);
  assert.equal(count(gl, 'drawArrays') - before, 2);
});

test('createSkyPass: no stars and no vignette skip their draws', () => {
  const gl = fakeGL();
  const pass = createSkyPass(gl, { linkProgram });
  const p = { sky: { ...SKY, stars: 0, vignette: false }, sun: SUN };
  pass.drawBack(scene(), p, null);
  assert.equal(count(gl, 'drawArrays'), 1);
  pass.drawFront(scene(), p, null);
  assert.equal(count(gl, 'drawArrays'), 2);
});

test('createSkyPass: resize re-uploads stars, rebuild recreates, dispose frees', () => {
  const gl = fakeGL();
  const pass = createSkyPass(gl, { linkProgram });
  pass.drawBack(scene(), settings(), null);
  pass.resize(800, 600, 1);
  pass.drawBack(scene({ w: 800, h: 600, res: [800, 600] }), settings(), null);
  assert.equal(pass.stats.uploads, 2);
  pass.rebuild();
  assert.equal(pass.stats.builds, 2);
  pass.drawBack(scene(), settings(), null);
  assert.equal(pass.stats.uploads, 3);
  pass.dispose();
  pass.drawBack(scene(), settings(), null);
  pass.drawFront(scene(), settings(), null);
});

test('createSkyPass: dispose frees every buffer and program', () => {
  const gl = fakeGL();
  const pass = createSkyPass(gl, { linkProgram });
  pass.drawBack(scene(), settings(), null);
  pass.dispose();
  assert.equal(gl.live.size, 0);
});
