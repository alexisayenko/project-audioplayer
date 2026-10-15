import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthQuality, SYNTH_MAX_DPR } from './viz-synth-quality.js';

test('synthQuality follows the governor table', () => {
  const q2 = synthQuality(2, {});
  assert.deepEqual([q2.starsAnimated, q2.hazeMotion, q2.sliceDetail, q2.cellMul, q2.glowPasses, q2.reflBlur, q2.dprCap], [true, true, 'full', 1, 2, true, 1.5]);
  assert.equal(synthQuality(2, { hiDpr: true }).dprCap, 2);
  const q1 = synthQuality(1, { hiDpr: true });
  assert.deepEqual([q1.starsAnimated, q1.hazeMotion, q1.sliceDetail, q1.cellMul, q1.glowPasses, q1.reflBlur, q1.dprCap], [false, false, 'full', 1, 2, true, 1.5]);
  const q0 = synthQuality(0, {});
  assert.deepEqual([q0.starsAnimated, q0.hazeMotion, q0.sliceDetail, q0.sliceScale, q0.sliceStepped, q0.cellMul, q0.glowPasses, q0.reflBlur, q0.dprCap], [false, false, 'low', 0.5, true, 2, 1, false, 1]);
  assert.equal(SYNTH_MAX_DPR, 1.5);
});

test('lite forces animation, glow and reflection blur off at any level', () => {
  for (const lv of [0, 1, 2]) {
    const q = synthQuality(lv, { lite: true });
    assert.equal(q.starsAnimated, false);
    assert.equal(q.hazeMotion, false);
    assert.equal(q.glowPasses, 0);
    assert.equal(q.reflBlur, false);
  }
  assert.equal(synthQuality(2, { lite: true }).cellMul, 1);
});

test('synthQuality clamps and defaults the level and passes half through', () => {
  assert.equal(synthQuality(9).level, 2);
  assert.equal(synthQuality(-4).level, 0);
  assert.equal(synthQuality(NaN).level, 1);
  assert.equal(synthQuality(1, { half: true }).half, true);
  assert.equal(synthQuality(1).half, false);
});

import { renderScaleFor, renderSize, clampShed, loadShed, saveShed, SHED_MAX, SHED_STORAGE_KEY } from './viz-synth-quality.js';

test('render scale shrinks monotonically down the shed ladder and never below the floor', () => {
  const scales = [0, 1, 2, 3].map(renderScaleFor);
  assert.deepEqual(scales, [1, 0.75, 0.6, 0.5]);
  for (let i = 1; i < scales.length; i += 1) assert.ok(scales[i] < scales[i - 1]);
  assert.equal(renderScaleFor(99), 0.5);
  assert.equal(renderScaleFor(NaN), 1);
  assert.equal(clampShed(-3), 0);
  assert.equal(clampShed(SHED_MAX + 4), SHED_MAX);
});

test('renderSize multiplies css size by dpr and scale with a one pixel floor', () => {
  assert.deepEqual(renderSize(1920, 1200, 1, 0.5), { w: 960, h: 600, ratio: 0.5 });
  assert.deepEqual(renderSize(1920, 1200, 1.5, 0.75), { w: 2160, h: 1350, ratio: 1.125 });
  assert.equal(renderSize(1920, 1200, 1, 3).w, 1920);
  assert.equal(renderSize(1920, 1200, 1, NaN).w, 1920);
  assert.equal(renderSize(0, 0, 1, 0.5).w, 1);
});

test('the full tier is the default: no render scale reduction, 2 glow rings x 4 taps', () => {
  const q = synthQuality(2, {});
  assert.deepEqual([q.shed, q.renderScale, q.glowPasses, q.glowTaps], [0, 1, 2, 4]);
});

test('shedding steps render scale and glow down together and never touch the level table at rung 0', () => {
  const r = [0, 1, 2, 3].map((shed) => synthQuality(2, { shed }));
  assert.deepEqual(r.map((q) => q.glowPasses), [2, 1, 0, 0]);
  assert.deepEqual(r.map((q) => q.glowTaps), [4, 2, 2, 2]);
  assert.deepEqual(r.map((q) => q.reflBlur), [true, true, false, false]);
  assert.deepEqual(r.map((q) => q.cellMul), [1, 1, 1, 2]);
  assert.deepEqual(r.map((q) => q.renderScale), [1, 0.75, 0.6, 0.5]);
});

test('the learned rung persists per pixel bucket and ignores a bad or foreign value', () => {
  const store = new Map();
  const ls = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(loadShed(ls, 2304000), 0);
  saveShed(ls, 2304000, 2);
  assert.equal(loadShed(ls, 2304000), 2);
  assert.equal(loadShed(ls, 2304000 + 100000), 2);
  assert.equal(loadShed(ls, 8000000), 0);
  store.set(SHED_STORAGE_KEY, 'not json');
  assert.equal(loadShed(ls, 2304000), 0);
  assert.doesNotThrow(() => saveShed({ setItem() { throw new Error('denied'); } }, 1, 1));
  assert.equal(loadShed(null, 1), 0);
  assert.equal(loadShed({ getItem() { throw new Error('denied'); } }, 1), 0);
});
