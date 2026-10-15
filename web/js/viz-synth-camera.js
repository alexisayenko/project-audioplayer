import { mat4Perspective, mat4LookAt, mat4Multiply } from './viz-terrain-math.js';

export const SYNTH_FOV_DEG = 62;
export const SYNTH_NEAR = 0.3;
export const SYNTH_FAR = 160;
const AIM_DIST = 10;
const RAD = Math.PI / 180;

const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function synthCamera(aspect, horizonV, eye) {
  const hv = num(horizonV, 0.05, 0.95, 0.4);
  const e = num(eye, 0.2, 10, 2.6);
  const ndcY = 1 - 2 * hv;
  const pitch = -Math.atan(ndcY * Math.tan((SYNTH_FOV_DEG * RAD) / 2));
  return {
    eye: [0, e, 0],
    target: [0, e + Math.sin(pitch) * AIM_DIST, Math.cos(pitch) * AIM_DIST],
    up: [0, 1, 0],
    fov: SYNTH_FOV_DEG,
    pitchDeg: pitch / RAD,
    near: SYNTH_NEAR,
    far: SYNTH_FAR,
    aspect: num(aspect, 0.2, 6, 1.78),
  };
}

export function viewProj(cam, aspect, out = new Float32Array(16)) {
  const a = num(aspect, 0.2, 6, cam.aspect || 1.78);
  const proj = mat4Perspective(cam.fov * RAD, a, cam.near, cam.far);
  const view = mat4LookAt(cam.eye, cam.target, cam.up);
  return mat4Multiply(proj, view, out);
}

export function horizonOf(cam) {
  const dy = cam.target[1] - cam.eye[1];
  const dz = cam.target[2] - cam.eye[2];
  const down = -Math.atan2(dy, Math.hypot(dz, cam.target[0] - cam.eye[0]));
  const ndc = Math.tan(down) / Math.tan((cam.fov * RAD) / 2);
  return (1 - ndc) / 2;
}
