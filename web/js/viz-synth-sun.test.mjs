import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sunLayout, sliceBands, sunUniforms, hazeUniforms, reflectionUniforms, sunColorAt, advancePhase,
  SUN_FS, HAZE_FS, REFL_FS, createSunPass, hazeRects, sunRect, reflectionRect,
} from './viz-synth-sun.js';
import { linkProgram } from './viz-terrain-gl.js';

const P = {
  on: true, radius: 0.22, height: 0.5, top: '#ffd23f', bottom: '#ff2d95', mid: '#ff7a3d', midOn: true,
  sliceStart: 0.5, sliceCount: 7, sliceFirst: 0.025, sliceGrowth: 1.45, sliceEdge: 'smooth', sliceDrift: 0.2,
  ringOn: true, ringColor: '#ff5a3c', ringRadius: 1.5, ringSoft: 0.7, ringAlpha: 0.55, ringShape: 'ring',
  bandOn: true, bandColor: '#ff3d8a', bandHeight: 0.06, hazeMove: 0.4,
  refl: 'streak', reflFollow: true, reflColor: '#ff5aa5', reflOpacity: 0.5, reflLength: 0.5, reflFade: 0.7,
  reflRipple: 0.3, sheen: true, sheenAmount: 0.35,
};
const scene = (o = {}) => ({ w: 800, h: 450, dpr: 1, aspect: 800 / 450, res: [800, 450], horizonV: 0.4, time: 1, dt: 0.016, reduced: false, q: { hazeMotion: true, sliceDetail: 'full', reflBlur: true }, ...o });
const sig = { bass: 0.5, energy: 0.5, pulse: 0.5, flash: 1 };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('sunLayout places the centre above the horizon by height radii', () => {
  const l = sunLayout(scene(), P);
  near(l.cx, 0.5);
  near(l.r, 0.22);
  near(l.cy, 0.4 - 0.5 * 0.22);
  near(sunLayout(scene(), { ...P, height: -0.5 }).cy, 0.4 + 0.11);
});

test('sun height 0 is half sunk, 1 touches the horizon, the ratio survives a radius change', () => {
  for (const r of [0.1, 0.22, 0.5]) {
    near(sunLayout(scene(), { ...P, radius: r, height: 0 }).cy, 0.4);
    const t = sunLayout(scene(), { ...P, radius: r, height: 1 });
    near(t.cy + t.r, 0.4);
    const f = sunLayout(scene(), { ...P, radius: r, height: 2 });
    near((0.4 - f.cy) / f.r, 2);
  }
});

test('sliceBands start below sliceStart, grow, are ordered and clipped', () => {
  const b = sliceBands(P);
  assert.ok(b.length > 0 && b.length <= 7);
  assert.ok(b[0].y0 > 0.5);
  b.forEach((x, i) => {
    assert.ok(x.y1 > x.y0 && x.y1 <= 1);
    if (i) assert.ok(x.y0 > b[i - 1].y1);
    if (i && x.y1 < 1) assert.ok(x.y1 - x.y0 > b[i - 1].y1 - b[i - 1].y0);
  });
  assert.deepEqual(sliceBands({ ...P, sliceCount: 0 }), []);
  assert.ok(sliceBands({ ...P, sliceStart: 0.9, sliceCount: 16 }).length <= 16);
  assert.ok(sliceBands({ ...P, sliceStart: 0.99, sliceFirst: 0.1 }).every((x) => x.y1 <= 1));
  assert.equal(sliceBands({ ...P, sliceCount: 99, sliceFirst: 0.005, sliceGrowth: 1 }).length, 16);
});

test('sunColorAt samples the gradient with and without a middle stop', () => {
  const top = sunColorAt(P, 0);
  near(top[0], 1);
  near(top[1], 0xd2 / 255);
  const mid = sunColorAt(P, 0.5);
  near(mid[1], 0x7a / 255);
  near(sunColorAt(P, 1)[2], 0x95 / 255);
  const two = sunColorAt({ ...P, midOn: false }, 0.5);
  near(two[1], (0xd2 + 0x2d) / 2 / 255);
  assert.deepEqual(sunColorAt(P, -3), sunColorAt(P, 0));
  assert.deepEqual(sunColorAt(P, 7), sunColorAt(P, 1));
});

test('sunUniforms pads bands, switches edges and limits brightness', () => {
  const u = sunUniforms(scene(), P, sig, { slice: 0, haze: 0 });
  assert.equal(u.uBands.length, 32);
  assert.equal(u.uBandCount, sliceBands(P).length);
  near(u.uBands[u.uBandCount * 2], 0);
  near(u.uBright, 1.15);
  assert.ok(u.uEdgeSoftPx > 0 && u.uStepPx === 0);
  const st = sunUniforms(scene(), { ...P, sliceEdge: 'stepped' }, sig, null);
  assert.equal(st.uEdgeSoftPx, 0);
  assert.equal(st.uStepPx, 4);
  const lo = sunUniforms(scene({ q: { sliceDetail: 'half' } }), P, sig, null);
  assert.equal(lo.uBandCount, Math.ceil(sliceBands(P).length / 2));
  assert.equal(lo.uEdgeSoftPx, 0);
  assert.equal(sunUniforms(scene(), P, { flash: 5 }, null).uBright, 1.15);
  assert.equal(sunUniforms(scene(), P, null, null).uBright, 1);
  assert.equal(sunUniforms(scene(), { ...P, on: false }, sig, null).uOn, 0);
});

test('drift phase maps to a growth power and is identity at zero', () => {
  near(sunUniforms(scene(), P, sig, { slice: 0 }).uDrift[2], 1);
  near(sunUniforms(scene(), P, sig, { slice: 0.5 }).uDrift[2], Math.sqrt(1.45), 1e-9);
  assert.ok(Number.isFinite(sunUniforms(scene(), { ...P, sliceGrowth: 1 }, sig, { slice: 0.3 }).uDrift[1]));
});

test('hazeUniforms keeps the gain within 15 percent and respects switches', () => {
  const u = hazeUniforms(scene(), P, sig, { haze: 0 });
  near(u.uRingAlpha, 0.55 * 1.15);
  assert.equal(u.uRingBand, 0);
  assert.equal(hazeUniforms(scene(), { ...P, ringShape: 'band' }, sig, null).uRingBand, 1);
  assert.equal(hazeUniforms(scene(), { ...P, ringOn: false }, sig, null).uRingOn, 0);
  assert.equal(hazeUniforms(scene(), { ...P, bandOn: false }, sig, null).uBandOn, 0);
  near(hazeUniforms(scene(), { ...P, hazeMove: 0 }, { flash: 1 }, { haze: 1 }).uRadius, 0.22);
  const a = hazeUniforms(scene(), P, { flash: 0 }, { haze: Math.PI / 2 }).uRadius;
  const b = hazeUniforms(scene(), P, { flash: 0 }, { haze: -Math.PI / 2 }).uRadius;
  assert.ok(a > 0.22 && b < 0.22);
});

test('reflectionUniforms centres on the sun and follows its gradient', () => {
  const u = reflectionUniforms(scene(), P, sig, { haze: 0, slice: 0 });
  near(u.uCx, 0.5);
  near(u.uLength, 0.5 * 0.6);
  near(u.uOpacity, 0.5 * 1.15);
  assert.equal(u.uFollow, 1);
  assert.deepEqual(u.uTop, sunColorAt(P, 0));
  assert.equal(reflectionUniforms(scene(), { ...P, refl: 'off' }, sig, null).uOpacity, 0);
  assert.equal(reflectionUniforms(scene(), { ...P, refl: 'blur' }, sig, null).uStyle, 1);
  assert.equal(reflectionUniforms(scene(), { ...P, sheen: false }, sig, null).uSheen, 0);
  assert.equal(reflectionUniforms(scene({ q: { reflBlur: false } }), P, sig, null).uSoft, 0);
  near(reflectionUniforms(scene({ horizonV: 0.6 }), P, sig, null).uLength, 0.5 * 0.4);
});

test('advancePhase moves, wraps, and freezes when reduced or without motion', () => {
  const q = { hazeMotion: true };
  const a = advancePhase({ slice: 0, haze: 0 }, 0.1, P, q, false);
  assert.ok(a.slice > 0 && a.haze > 0);
  const w = advancePhase({ slice: 0.999, haze: 6.28 }, 0.25, { ...P, sliceDrift: 1, hazeMove: 1 }, q, false);
  assert.ok(w.slice >= 0 && w.slice < 1 && w.haze >= 0 && w.haze < Math.PI * 2);
  assert.deepEqual(advancePhase({ slice: 0.3, haze: 1 }, 1, P, q, true), { slice: 0.3, haze: 1 });
  assert.deepEqual(advancePhase({ slice: 0.3, haze: 1 }, 1, P, { hazeMotion: false }, false), { slice: 0.3, haze: 1 });
  assert.deepEqual(advancePhase({ slice: 0.3, haze: 1 }, 1, { ...P, sliceDrift: 0, hazeMove: 0 }, q, false), { slice: 0.3, haze: 1 });
  assert.deepEqual(advancePhase(null, NaN, P, q, false), { slice: 0, haze: 0 });
  const out = { slice: 9, haze: 9 };
  assert.equal(advancePhase(null, 0, P, q, false, out), out);
});

test('shader sources declare the uniforms the uniform builders emit', () => {
  const has = (src, names) => names.forEach((n) => assert.ok(new RegExp(`uniform [a-z0-9]+ ${n}(\\[|;)`).test(src), n));
  has(SUN_FS, Object.keys(sunUniforms(scene(), P, sig, null)));
  has(HAZE_FS, Object.keys(hazeUniforms(scene(), P, sig, null)));
  has(REFL_FS, Object.keys(reflectionUniforms(scene(), P, sig, null)));
  for (const src of [SUN_FS, HAZE_FS, REFL_FS]) assert.ok(src.includes('gl_FragColor'));
});

function fakeGL() {
  const log = [];
  const consts = {};
  let id = 0;
  const gl = new Proxy({}, {
    get(_, k) {
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return (consts[k] ??= ++id);
      return (...a) => {
        log.push([k, ...a]);
        if (k === 'getShaderParameter' || k === 'getProgramParameter') return true;
        if (k === 'getUniformLocation') return { n: a[1] };
        return { k, id: ++id };
      };
    },
  });
  return { gl, log };
}

test('createSunPass draws haze, sun and reflection with cached uniforms', () => {
  const { gl, log } = fakeGL();
  const pass = createSunPass(gl, { linkProgram });
  assert.equal(pass.stats.programs, 3);
  const s = scene();
  pass.drawHaze(s, P, sig);
  pass.drawSun(s, P, sig);
  pass.drawReflection(s, P, sig);
  assert.equal(pass.stats.draws, 4);
  const up1 = pass.stats.uploads;
  pass.drawSun(s, P, sig);
  assert.equal(pass.stats.draws, 5);
  assert.equal(pass.stats.uploads, up1);
  assert.equal(log.filter((l) => l[0] === 'drawArrays').length, 5);
  assert.ok(log.some((l) => l[0] === 'uniform1fv'));
});

test('createSunPass skips disabled parts and draw runs all three', () => {
  const { gl } = fakeGL();
  const pass = createSunPass(gl, { linkProgram });
  const off = { ...P, on: false, bandOn: false, ringOn: false, sheen: false };
  const s = scene();
  pass.drawHaze(s, off, sig);
  pass.drawSun(s, off, sig);
  pass.drawReflection(s, off, sig);
  assert.equal(pass.stats.draws, 0);
  pass.drawReflection(s, { ...P, refl: 'off', sheen: false }, sig);
  assert.equal(pass.stats.draws, 0);
  pass.draw(scene({ time: 2 }), P, sig);
  assert.equal(pass.stats.draws, 4);
});

test('rebuild recreates programs and clears cached uniforms; dispose frees', () => {
  const { gl, log } = fakeGL();
  const pass = createSunPass(gl, { linkProgram });
  const s = scene();
  pass.drawSun(s, P, sig);
  const before = pass.stats.uploads;
  pass.rebuild();
  assert.equal(pass.stats.rebuilds, 1);
  pass.drawSun(s, P, sig);
  assert.ok(pass.stats.uploads > before);
  pass.dispose();
  assert.ok(log.filter((l) => l[0] === 'deleteProgram').length >= 3);
  pass.dispose();
});

test('each sun pass is scissored to its own bounds and counts far less than full-screen fill', () => {
  const { gl, log } = fakeGL();
  const pass = createSunPass(gl, { linkProgram });
  const s = scene({ res: [1920, 1200], fill: { px: 0, quads: 0 } });
  pass.draw(s, P, sig);
  const full = 1920 * 1200;
  assert.ok(s.fill.quads >= 3);
  assert.ok(s.fill.px < full * 1.6, 'sun+haze+reflection fill ' + s.fill.px / full);
  assert.equal(log.filter((l) => l[0] === 'scissor').length, log.filter((l) => l[0] === 'drawArrays').length);
  assert.equal(log.filter((l) => l[0] === 'enable' && l[1] === gl.SCISSOR_TEST).length, log.filter((l) => l[0] === 'disable' && l[1] === gl.SCISSOR_TEST).length);
});

test('haze and reflection rectangles stay inside the frame and skip invisible parts', () => {
  const s = scene({ res: [1000, 500] });
  const r = hazeRects(s, { ...P, on: true, ringOn: true, ringAlpha: 0, bandOn: false });
  assert.equal(r.ring, null);
  assert.equal(r.band, null);
  const sr = sunRect(s, P);
  assert.ok(sr[2] - sr[0] > 0 && sr[2] - sr[0] <= 2 * P.radius * 500 + 6);
  const rr = reflectionRect(s, { ...P, refl: 'blur', reflOpacity: 0.5, reflLength: 0.5, sheen: false });
  assert.ok(rr[1] >= 0 && rr[3] > rr[1]);
});
