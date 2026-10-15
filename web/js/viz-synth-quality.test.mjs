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
