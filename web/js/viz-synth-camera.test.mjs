import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthCamera, viewProj, horizonOf, SYNTH_FOV_DEG } from './viz-synth-camera.js';
import { transformPoint } from './viz-terrain-math.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('camera sits at the eye height looking down the grid', () => {
  const cam = synthCamera(1.78, 0.4, 2.6);
  assert.deepEqual(cam.eye, [0, 2.6, 0]);
  assert.equal(cam.fov, SYNTH_FOV_DEG);
  assert.ok(cam.pitchDeg < 0 && cam.pitchDeg > -30);
  assert.ok(cam.target[2] > 0 && cam.target[1] < cam.eye[1]);
});

test('horizon round trip returns the requested row', () => {
  for (const hv of [0.25, 0.33, 0.4, 0.5, 0.6]) near(horizonOf(synthCamera(1.5, hv, 3)), hv);
});

test('a point at infinity projects onto the horizon row', () => {
  for (const hv of [0.3, 0.4, 0.55]) {
    const cam = synthCamera(1.78, hv, 2.6);
    const m = viewProj(cam, 1.78);
    const q = transformPoint(m, [0, 0, 1e7]);
    near((1 - q[1] / q[3]) / 2, hv, 1e-3);
    near(q[0] / q[3], 0, 1e-4);
  }
});

test('ground ahead of the camera lands below the horizon', () => {
  const m = viewProj(synthCamera(1.78, 0.4, 2.6), 1.78);
  const q = transformPoint(m, [0, 0, 20]);
  assert.ok((1 - q[1] / q[3]) / 2 > 0.4);
});

test('viewProj fills and returns the given output and survives bad input', () => {
  const out = new Float32Array(16);
  assert.equal(viewProj(synthCamera(1.78, 0.4, 2.6), 1.78, out), out);
  assert.ok(out.every(Number.isFinite));
  const cam = synthCamera(NaN, NaN, NaN);
  assert.ok(viewProj(cam, NaN).every(Number.isFinite));
  near(synthCamera(1, 0.4, 99).eye[1], 10);
});
