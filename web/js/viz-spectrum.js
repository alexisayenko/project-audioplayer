import {
  MIN_HZ, MAX_HZ, BASS_HZ, NOISE_FLOOR, DPR_CAP, FPS_TOUCH, FPS_DESKTOP, QUALITY_LEVELS, PULSE_MAX_RATE, MIN_TURN_S,
  BAR_PITCH_PX, BAR_COUNT_MIN, BAR_COUNT_MAX, EDGE_FADE, HEIGHT_KNEE, HEIGHT_MAX, BAR_NOISE, NOISE_STEP_MS, BAR_COMPRESSION,
  RANGE_DB, TILT_DB_PER_OCT, REF_HEADROOM_DB, REF_RISE, REF_FALL_DB_PER_S, REF_MIN_DB,
} from './viz-constants.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function dbToUnit(db, minDb = -100, maxDb = -30) {
  if (!Number.isFinite(db) || !(maxDb > minDb)) return 0;
  return clamp01((db - minDb) / (maxDb - minDb));
}

const gate = (u, floor) => (u <= floor ? 0 : (u - floor) / (1 - floor));

export function barEdges(n, sampleRate, fftSize, fMin = MIN_HZ, fMax = MAX_HZ) {
  const hi = Math.min(fMax, sampleRate / 2);
  const lo = Math.max(1, Math.min(fMin, hi / 2));
  const edges = new Float32Array(n + 1);
  for (let i = 0; i <= n; i += 1) edges[i] = lo * (hi / lo) ** (i / n);
  return edges;
}

function binDb(db, i) {
  const v = db[Math.min(db.length - 1, Math.max(0, i))];
  return Number.isFinite(v) ? v : -Infinity;
}

function barPeakDb(db, lo, hi, binW) {
  const first = Math.max(1, Math.floor(lo / binW));
  const last = Math.max(first, Math.ceil(hi / binW) - 1);
  if (last === first) return binDb(db, Math.round(Math.sqrt(lo * hi) / binW));
  let peak = -Infinity;
  for (let i = first; i <= last; i += 1) peak = Math.max(peak, binDb(db, i));
  return peak;
}

export function barsDb(db, n, opts) {
  const { sampleRate, fftSize, tilt = 0 } = opts;
  const out = new Float32Array(n).fill(-Infinity);
  if (!db || !db.length || !(n > 0)) return out;
  const edges = barEdges(n, sampleRate, fftSize);
  const binW = sampleRate / fftSize;
  for (let i = 0; i < n; i += 1) {
    const mid = Math.sqrt(edges[i] * edges[i + 1]);
    out[i] = barPeakDb(db, edges[i], edges[i + 1], binW) + tilt * Math.log2(mid / 1000);
  }
  return out;
}

export function unitBars(dbBars, opts) {
  const { floor = NOISE_FLOOR, minDb, maxDb } = opts;
  const out = new Float32Array(dbBars.length);
  for (let i = 0; i < out.length; i += 1) out[i] = gate(dbToUnit(dbBars[i], minDb, maxDb), floor);
  return out;
}

export function resampleBars(db, n, opts) {
  return unitBars(barsDb(db, n, opts), opts);
}

export function makeReference({
  range = RANGE_DB, headroom = REF_HEADROOM_DB, rise = REF_RISE, fall = REF_FALL_DB_PER_S, minRef = REF_MIN_DB,
} = {}) {
  let ref = null;
  const window = () => ({ maxDb: ref + headroom, minDb: ref + headroom - range });
  return {
    update(dbBars, dt = 1 / 30) {
      let peak = -Infinity;
      for (const v of dbBars) if (v > peak) peak = v;
      const target = Math.max(minRef, peak);
      if (ref === null) ref = target;
      else if (target > ref) ref += (target - ref) * (1 - (1 - rise) ** (dt * 60));
      else ref = Math.max(target, ref - fall * dt);
      return window();
    },
    reset() { ref = null; },
  };
}

export function bassEnergy(db, opts) {
  const { sampleRate, fftSize, floor = NOISE_FLOOR, maxHz = BASS_HZ } = opts;
  if (!db || !db.length) return 0;
  const last = Math.max(1, Math.min(db.length - 1, Math.floor(maxHz / (sampleRate / fftSize))));
  let sum = 0;
  for (let i = 1; i <= last; i += 1) sum += dbToUnit(binDb(db, i), opts.minDb, opts.maxDb);
  return gate(sum / last, floor);
}

export function smoothBars(state, target, attack, release, frames = 1) {
  const ka = 1 - (1 - attack) ** frames;
  const kr = 1 - (1 - release) ** frames;
  for (let i = 0; i < state.length; i += 1) {
    const t = Number.isFinite(target[i]) ? target[i] : 0;
    state[i] += (t - state[i]) * (t > state[i] ? ka : kr);
  }
  return state;
}

export function updatePeaks(peaks, bars, fall = 0.012, frames = 1) {
  for (let i = 0; i < peaks.length; i += 1) {
    peaks[i] = Math.max(bars[i], peaks[i] - fall * frames);
  }
  return peaks;
}

export function maxOf(values) {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function idleBars(n, t = 0) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = 0.05 + 0.03 * Math.sin(t * 0.0015 + i * 0.35);
  return out;
}

export function makePulse({ attack = 0.5, release = 0.15, maxRate = PULSE_MAX_RATE, minTurn = MIN_TURN_S } = {}) {
  let value = 0;
  let clock = 0;
  let dir = 0;
  let turnAt = -Infinity;
  const direction = (delta) => {
    const want = Math.abs(delta) < 1e-4 ? 0 : Math.sign(delta);
    if (want === 0 || want === dir) return want;
    if (dir !== 0 && clock - turnAt < minTurn) return 0;
    dir = want;
    turnAt = clock;
    return want;
  };
  return {
    get value() { return value; },
    step(target, dt = 1 / 60) {
      clock += dt;
      const t = clamp01(Number.isFinite(target) ? target : 0);
      const k = 1 - (1 - (t > value ? attack : release)) ** (dt * 60);
      const delta = (t - value) * k;
      const sign = direction(delta);
      const lim = maxRate * dt;
      value = clamp01(value + (sign === 0 ? 0 : Math.max(-lim, Math.min(lim, delta))));
      return value;
    },
    reset() { value = 0; dir = 0; turnAt = -Infinity; },
  };
}

export const targetFps = (coarse) => (coarse ? FPS_TOUCH : FPS_DESKTOP);
export const capDpr = (dpr, cap = DPR_CAP) => Math.min(cap, Math.max(1, Number.isFinite(dpr) ? dpr : 1));

export function makePacer(fps) {
  let gap = 1000 / fps;
  let last = -Infinity;
  return {
    due(now, slack = 4) {
      if (now - last < gap - slack) return false;
      last = now;
      return true;
    },
    set(next) { if (next > 0) gap = 1000 / next; },
    get gap() { return gap; },
    reset() { last = -Infinity; },
  };
}

export function makeGovernor({
  fps = FPS_DESKTOP, window = 30, startLevel = 1, fastMs = 10, fastFrames = 60, levels = QUALITY_LEVELS,
} = {}) {
  const budget = (1000 / fps) * 0.5;
  let level = Math.min(levels.length - 1, Math.max(0, startLevel));
  let sum = 0;
  let count = 0;
  let fast = 0;
  const close = () => {
    const avg = sum / count;
    sum = 0;
    count = 0;
    if (avg > budget) { fast = 0; level = Math.min(levels.length - 1, level + 1); }
  };
  return {
    record(workMs) {
      const ms = Number.isFinite(workMs) ? workMs : 0;
      sum += ms;
      count += 1;
      fast = ms < fastMs ? fast + 1 : 0;
      if (fast >= fastFrames) { fast = 0; level = Math.max(0, level - 1); }
      if (count >= window) close();
      return level;
    },
    get level() { return level; },
    get budget() { return budget; },
    quality() { return levels[level]; },
  };
}

export function pickSpokes(bars, m) {
  const out = new Float32Array(m);
  if (!bars.length || !(m > 0)) return out;
  const per = bars.length / m;
  for (let i = 0; i < m; i += 1) {
    const a = Math.floor(i * per);
    const b = Math.min(bars.length, Math.max(a + 1, Math.floor((i + 1) * per)));
    let sum = 0;
    for (let k = a; k < b; k += 1) sum += bars[k];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

export const barCount = (width, scale = 1) => {
  const n = Math.round((Number.isFinite(width) ? width : 0) * scale / BAR_PITCH_PX);
  return Math.min(BAR_COUNT_MAX, Math.max(BAR_COUNT_MIN, n));
};

export function barHeight(v, knee = HEIGHT_KNEE, max = HEIGHT_MAX) {
  const u = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  return (max * (1 - Math.exp(-knee * u))) / (1 - Math.exp(-knee));
}

export function edgeAlpha(x, width, fade = EDGE_FADE) {
  if (!(width > 0)) return 1;
  const edge = Math.min(x, width - x) / (width * fade);
  return Math.min(1, Math.max(0, edge));
}

export function barNoise(i, step = 0) {
  const s = Math.sin((i + 1) * 12.9898 + (step % 100003) * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export const noiseStep = (tMs, stepMs = NOISE_STEP_MS) => Math.floor((Number.isFinite(tMs) ? tMs : 0) / stepMs);

export function shapeBars(values, tMs = 0, noise = BAR_NOISE, out = null) {
  const n = values.length;
  const res = out && out.length === n ? out : new Float32Array(n);
  const step = noiseStep(tMs);
  for (let i = 0; i < n; i += 1) {
    const v = values[i] > 0 ? values[i] ** BAR_COMPRESSION : 0;
    res[i] = Math.min(1, Math.max(0, v * (1 + noise * barNoise(i, step))));
  }
  return res;
}
