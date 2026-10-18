import { storeGet, storeSet } from './storage.js';
import {
  CAM_LIMITS, COVER_HALF_FOV, YAW_COVER_MAX_DEG, ASPECT_MAX, mulberry32, smoothstep,
} from './viz-terrain-math.js';

export const FLIGHT_KEY = 'ap2.viz.flight';
export const FLIGHT_EYE_AMP_REL = 0.4;
export const FLIGHT_YAW_AMP_DEG = 16;
export const FLIGHT_YAW_MIN_DEG = 8;
export const FLIGHT_PITCH_COUPLING_DEG = 1.5;
export const FLIGHT_EASE_IN_S = 3;
export const FLIGHT_EASE_OUT_S = 2;
export const FLIGHT_MAX_DT_S = 0.1;
export const FLIGHT_SPEED = 2;
export const FLIGHT_EYE_PERIODS_S = [40, 24.7, 17.4].map((p) => p / FLIGHT_SPEED);
export const FLIGHT_YAW_PERIODS_S = [30, 18.5, 13].map((p) => p / FLIGHT_SPEED);
export const FLIGHT_WEIGHTS = [0.55, 0.3, 0.15];
export const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const TAU = Math.PI * 2;

export const yawCoverDeg = (aspect = 16 / 9) => {
  const a = Math.min(ASPECT_MAX, Math.max(0.4, Number.isFinite(aspect) ? aspect : 16 / 9));
  return Math.max(0, YAW_COVER_MAX_DEG - Math.atan(Math.tan(COVER_HALF_FOV) * a) * (180 / Math.PI));
};

export const flightEyeAmp = (baseEye) => {
  const [lo, hi] = CAM_LIMITS.eye;
  return Math.max(0, Math.min(FLIGHT_EYE_AMP_REL * baseEye, baseEye - lo, hi - baseEye));
};

export function flightYawPlan(baseYaw, aspect = 16 / 9) {
  const cover = yawCoverDeg(aspect);
  const mag = Math.abs(baseYaw);
  const room = cover - mag;
  const amp = Math.max(FLIGHT_YAW_MIN_DEG, Math.min(FLIGHT_YAW_AMP_DEG, room));
  const over = Math.max(0, Math.min(mag, mag + amp - cover));
  const shift = over > 0 ? -Math.sign(baseYaw) * over : 0;
  return { amp, shift, limited: amp < FLIGHT_YAW_AMP_DEG - 1e-9 || shift !== 0, cover };
}

export const flightYawAmp = (baseYaw, aspect = 16 / 9) => flightYawPlan(baseYaw, aspect).amp;

function makeNoise(rnd, periods) {
  const phases = periods.map(() => rnd() * TAU);
  return (t) => {
    let v = 0;
    for (let i = 0; i < periods.length; i += 1) v += FLIGHT_WEIGHTS[i] * Math.sin((t / periods[i]) * TAU + phases[i]);
    return v;
  };
}

export function createFlight({ seed = 1 } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const eyeNoise = makeNoise(rnd, FLIGHT_EYE_PERIODS_S);
  const yawNoise = makeNoise(rnd, FLIGHT_YAW_PERIODS_S);
  const s = { on: false, prog: 0, time: 0, last: null, eyeN: 0, yawN: 0, playing: false, applied: { eye: 0, yaw: 0, pitch: 0 }, aspect: 16 / 9 };
  const amount = () => smoothstep(0, 1, s.prog);
  return {
    setOn(v) { s.on = !!v; },
    isOn: () => s.on,
    active: () => s.on || s.prog > 0,
    amount,
    time: () => s.time,
    isPlaying: () => s.playing,
    report(o, aspect) {
      s.applied = o;
      if (Number.isFinite(aspect)) s.aspect = aspect;
    },
    aspect: () => s.aspect,
    applied: () => s.applied,
    tick(tMs, playing) {
      const prev = s.last;
      s.last = tMs;
      s.playing = !!playing;
      const dt = prev === null || !Number.isFinite(tMs) ? 0 : Math.min(FLIGHT_MAX_DT_S, Math.max(0, (tMs - prev) / 1000));
      if (s.on) s.prog = Math.min(1, s.prog + dt / FLIGHT_EASE_IN_S);
      else s.prog = Math.max(0, s.prog - dt / FLIGHT_EASE_OUT_S);
      if (playing && (s.on || s.prog > 0)) s.time += dt;
      s.eyeN = eyeNoise(s.time);
      s.yawN = yawNoise(s.time);
    },
    offsets(base, aspect = 16 / 9) {
      const k = amount();
      if (!(k > 0)) return { eye: 0, yaw: 0, pitch: 0 }; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
      const eye = s.eyeN * flightEyeAmp(base.eye) * k;
      const plan = flightYawPlan(base.yaw, aspect);
      const yaw = (plan.shift + s.yawN * plan.amp) * k;
      const rel = flightEyeAmp(base.eye) > 0 ? eye / flightEyeAmp(base.eye) : 0;
      return { eye, yaw, pitch: -FLIGHT_PITCH_COUPLING_DEG * rel };
    },
    yawRange(baseYaw, aspect = 16 / 9) {
      return s.on || s.prog > 0 ? flightYawAmp(baseYaw, aspect) : 0;
    },
  };
}

export const flight = createFlight({ seed: Math.floor(Math.random() * 0xffffffff) }); // NOSONAR Math.random only seeds a visual effect, no security use

let stored = null;
let reducedOverride = null;
const listeners = new Set();

export const flightReduced = () => reducedOverride ?? globalThis.matchMedia?.(REDUCED_QUERY)?.matches ?? false;
export const parseFlight = (v) => v === '1';

export function flightOn() {
  stored ??= parseFlight(storeGet(FLIGHT_KEY));
  return stored && !flightReduced();
}

function sync() {
  flight.setOn(flightOn());
  for (const cb of listeners) cb(flightOn());
}

export function setFlightOn(v) {
  stored = !!v;
  storeSet(FLIGHT_KEY, stored ? '1' : '0');
  sync();
  return flightOn();
}

export function onFlight(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setReducedForTests(v) {
  reducedOverride = v;
  sync();
}

export function resetFlightForTests() {
  stored = null;
  reducedOverride = null;
  flight.setOn(false);
}

export function initFlight() { sync(); }
