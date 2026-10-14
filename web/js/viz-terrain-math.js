export const QUALITY = [
  { spacing: 1, cell: 0.35, bloom: false, smoke: 0, mist: 0, passes: 1, soft: 0 },
  { spacing: 0.6, cell: 0.2, bloom: false, smoke: 2, mist: 1, passes: 1, soft: 1 },
  { spacing: 0.4, cell: 0.12, bloom: true, smoke: 3, mist: 2, passes: 1, soft: 2 },
];
export const LOD_ROW_PX = 900;
export const LOD_FOOT = 2;
export const LOD_MERGE = 0.9;
export const LOD_MAX_SPACING = 1.4;
export const LOD_BLEND_CELLS = 3;
export const FAR_FLAT_START = 0.92;
export const GRID_MAX_VERTICES = 30000;
export const HISTORY_BINS = 64;
export const ROWS_PER_SECOND = 16;
export const SHAKE_MAX = 0.03;
export const SHAKE_ENABLED = false;
export const GRID_DEPTH = 40;
export const CALM_DEPTH = 12;
export const COVER_DEPTH = 0.9 * GRID_DEPTH;
export const COVER_MARGIN = 1.1;
export const COVER_HALF_FOV = 32.5 * (Math.PI / 180);
export const COL_SHAPE = 1;
export const WIDTH_PER_ASPECT = Math.tan(COVER_HALF_FOV) * COVER_DEPTH * COVER_MARGIN;
export const WORLD_SPEED = 5.5;
export const LOOK_S = 5;
export const NOW_Z = GRID_DEPTH - LOOK_S * WORLD_SPEED;
export const NOW_FALLOFF_S = 0.3;
export const NOW_GAIN = 1.6;
export const AMP_BASE = 1;
export const AMP_GAIN = 1.9;
export const AMP_MAX = AMP_BASE + AMP_GAIN;
const lightLen = Math.hypot(0.6, 0.5, -0.25);
export const LIGHT_DIR = [0.6 / lightLen, 0.5 / lightLen, -0.25 / lightLen];
export const LIGHT_GAIN = 1.6;
export const LIGHT_SPAN = 2;
export const LIGHT_MIN_DX = 0.5;
export const NODE_GAIN = 1.6;
export const FOG_NEAR = 0.15;
export const FOG_FAR = 0.95;
export const FOG_LOW_MIN = 0.35;
export const FOG_H0 = 0.3;
export const FOG_H1 = 2.2;
export const LANDMARK_PERIOD_S = 5;
export const LANDMARK_GAIN = 1.8;
export const LANDMARK_BONUS = 0.4;
export const LANDMARK_MAX = 4.5;
export const KNEE = 0.7;
export const HEIGHT_CAP = LANDMARK_MAX / AMP_MAX;
export const HEIGHT_RESAMPLE_CAP = HEIGHT_CAP * 1.08;
export const LANDMARK_SPREAD_S = 0.25;
export const LANDMARK_MIN_ENERGY = 0.15;
export const LANDMARK_LIVE_KEEP = 0.9;
export const LANDMARK_SIGMA_X = 0.08;
export const LANDMARK_MIN_PEAKINESS = 1.6;
const LANDMARK_REACH = 3;
export const CROSS_H0 = 0.4;
export const CROSS_H1 = 0.6;
export const crossAlpha = (worldHeight) => smoothstep(CROSS_H0, CROSS_H1, worldHeight);
export const LIVE_CAP = Math.ceil((GRID_DEPTH / WORLD_SPEED) * ROWS_PER_SECOND) + 8;
export const EYE_HEIGHT = 3.31;
export const DEFAULT_PITCH_DEG = -13.5;
export const CAM_LIMITS = { eye: [0.2, 10], pitch: [-30, 15], yaw: [-45, 45], sync: [-1000, 1000] };
export const YAW_COVER_MAX_DEG = 85;
export const NEAR_YAW_COVER_MAX_DEG = 70;
export const YAW_WIDTH_MAX = 3;
export const FAR_WIDTH_MAX = 8;
export const ASPECT_MAX = 4.2;
export const YAW_STEP_DEG = 5;
export const NEAR_CALM = 0.35;
export const RAMP = [
  { at: 0, c: [0.02, 0.05, 0.14] },
  { at: 0.45, c: [0.12, 0.55, 0.85] },
  { at: 1, c: [0.9, 0.98, 1] },
];

export const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function softKnee(h, max = HEIGHT_CAP, k = KNEE) {
  const knee = k * max;
  if (!(h > knee)) return h;
  const span = (1 - k) * max;
  const x = (h - knee) / span;
  return knee + (span * x) / (1 + x);
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function qualityFor(level) {
  const i = Number.isFinite(level) ? Math.min(QUALITY.length - 1, Math.max(0, Math.round(level))) : 1;
  return QUALITY[i];
}

export function gridDims(level, aspect) {
  const hw = gridHalfWidth(aspect);
  let sp = qualityFor(level).spacing;
  let rows = 0;
  let cols = 0;
  for (let i = 0; i < 80; i += 1) {
    rows = Math.round(GRID_DEPTH / sp) + 1;
    cols = Math.round((2 * hw) / sp) + 1;
    if (rows * cols <= GRID_MAX_VERTICES) break;
    sp *= 1.06;
  }
  return { rows, cols, spacing: sp, dz: GRID_DEPTH / (rows - 1), dx: (2 * hw) / (cols - 1) };
}

export function tierHalfWidth(zEnd, aspect, yawDeg = 0, near = false) {
  const a = Math.min(near ? 3.6 : ASPECT_MAX, Math.max(0.4, Number.isFinite(aspect) ? aspect : 1.78));
  const gw = gridHalfWidth(a);
  const reach = COVER_MARGIN * (zEnd + LOD_FOOT);
  const base = Math.min(near ? gw : gw * FAR_WIDTH_MAX, Math.tan(COVER_HALF_FOV) * a * reach);
  const y = Math.abs(Number.isFinite(yawDeg) ? yawDeg : 0);
  if (!(y > 0)) return base;
  const capDeg = near ? NEAR_YAW_COVER_MAX_DEG : YAW_COVER_MAX_DEG;
  const ang = Math.min(Math.atan(Math.tan(COVER_HALF_FOV) * a) + y * (Math.PI / 180), capDeg * (Math.PI / 180));
  const wide = Math.tan(ang) * reach;
  return Math.min(Math.max(base, wide), gw * (near ? YAW_WIDTH_MAX : FAR_WIDTH_MAX));
}

export const yawStepOf = (yawDeg) => (Number.isFinite(yawDeg) ? Math.ceil(Math.abs(yawDeg) / YAW_STEP_DEG - 1e-9) * YAW_STEP_DEG : 0);

export function lodTiers(level, aspect, nowZ = NOW_Z, yawDeg = 0) {
  const base = qualityFor(level).cell;
  const tiers = [];
  let z0 = 0;
  for (let k = 0; z0 < GRID_DEPTH - 1e-6 && k < 12; k += 1) {
    const nominal = base * 2 ** k;
    let z1 = Math.sqrt(nominal * LOD_ROW_PX);
    if (z1 >= LOD_MERGE * GRID_DEPTH || nominal * 2 > LOD_MAX_SPACING) z1 = GRID_DEPTH;
    z1 = Math.max(z1, Math.min(GRID_DEPTH, z0 + nominal));
    const last = z1 >= GRID_DEPTH;
    const wOut = last ? 0 : LOD_BLEND_CELLS * nominal * 2;
    const wIn = k === 0 ? 0 : LOD_BLEND_CELLS * nominal;
    const zA = 0;
    const zB = Math.min(GRID_DEPTH, z1 + wOut);
    const want = tierHalfWidth(zB, aspect, yawDeg, k === 0);
    let sp = nominal;
    let half = 0;
    let rows = 0;
    let cols = 0;
    let jz0 = 0;
    for (let i = 0; i < 80; i += 1) {
      half = Math.ceil(want / sp);
      cols = 2 * half + 1;
      jz0 = Math.floor((zA - nowZ) / sp);
      rows = Math.ceil((zB - nowZ) / sp) - jz0 + 2;
      if (rows * cols <= GRID_MAX_VERTICES) break;
      sp *= 1.06;
    }
    const fade = [k === 0 ? -2 : z0 - wIn, k === 0 ? -1 : z0 + wIn, last ? GRID_DEPTH + 2 : z1 - wOut, last ? GRID_DEPTH + 3 : z1 + wOut];
    tiers.push({ k, z0, z1, zA, zB, fade, phw: k === 0 ? 0 : tiers[k - 1].hw, spacing: sp, dz: sp, dx: sp, hw: half * sp, rows, cols, jz0 });
    z0 = z1;
  }
  return tiers;
}

const smooth01 = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function tierWeight(t, x, z) {
  const rho = Math.hypot(x, z);
  const own = 1 - smooth01(t.fade[2], t.fade[3], rho);
  const prev = t.phw > 0 ? (1 - smooth01(0.8, 1, Math.abs(x) / t.phw)) * (1 - smooth01(t.fade[0], t.fade[1], rho)) : 0;
  return Math.max(0, own - prev);
}

export function catmull(t, out, o = 0) {
  const t2 = t * t;
  const t3 = t2 * t;
  out[o] = -0.5 * t3 + t2 - 0.5 * t;
  out[o + 1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[o + 2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[o + 3] = 0.5 * t3 - 0.5 * t2;
  return out;
}

export function makeTierPlan(lat, tier, nowZ) {
  const cols = tier.cols;
  const idx = new Int32Array(cols * 4);
  const wt = new Float32Array(cols * 4);
  const last = lat.cols - 1;
  for (let c = 0; c < cols; c += 1) {
    const u = ((c / (cols - 1)) * 2 - 1) * tier.hw;
    const p = Math.min(last, Math.max(0, (u / lat.hw * 0.5 + 0.5) * last));
    const i = Math.min(last - 1, Math.floor(p));
    catmull(p - i, wt, c * 4);
    for (let k = 0; k < 4; k += 1) idx[c * 4 + k] = Math.min(last, Math.max(0, i - 1 + k));
  }
  const span = Math.ceil(((tier.rows + 2) * tier.dz) / lat.dz) + 6;
  return { lat, tier, nowZ, idx, wt, span, buf: new Float32Array(span * cols), rw: new Float32Array(4) };
}

export function resampleTier(plan, src, dst, fracL, fracT, lo = 0, hi = Infinity) {
  const { lat, tier, idx, wt, buf, rw } = plan;
  const cols = tier.cols;
  const lc = lat.cols;
  const lr = lat.rows - 1;
  const rAt = (j) => Math.min(lr, Math.max(0, (plan.nowZ + (j + tier.jz0 - fracT) * tier.dz) / lat.dz + fracL));
  const first = Math.max(0, Math.floor(rAt(0)) - 1);
  const last = Math.min(lr, Math.floor(rAt(tier.rows - 1)) + 2, first + plan.span - 1);
  for (let r = first; r <= last; r += 1) {
    const so = r * lc;
    const bo = (r - first) * cols;
    for (let c = 0; c < cols; c += 1) {
      const k = c * 4;
      buf[bo + c] = src[so + idx[k]] * wt[k] + src[so + idx[k + 1]] * wt[k + 1] + src[so + idx[k + 2]] * wt[k + 2] + src[so + idx[k + 3]] * wt[k + 3];
    }
  }
  const at = (r) => (Math.min(last, Math.max(first, r)) - first) * cols;
  for (let j = 0; j < tier.rows; j += 1) {
    const p = rAt(j);
    const i = Math.min(Math.max(0, lr - 1), Math.floor(p));
    catmull(p - i, rw);
    const a = at(i - 1);
    const b = at(i);
    const c2 = at(i + 1);
    const d = at(i + 2);
    const o = j * cols;
    for (let c = 0; c < cols; c += 1) {
      const v = buf[a + c] * rw[0] + buf[b + c] * rw[1] + buf[c2 + c] * rw[2] + buf[d + c] * rw[3];
      dst[o + c] = v < lo ? lo : v > hi ? hi : v;
    }
  }
  return dst;
}

export function resample(bins, n) {
  const out = new Float32Array(n);
  const len = bins?.length || 0;
  if (!len || !(n > 0)) return out;
  if (len === 1) return out.fill(clamp01(bins[0]));
  for (let i = 0; i < n; i += 1) {
    const pos = n === 1 ? 0 : (i / (n - 1)) * (len - 1);
    const a = Math.floor(pos);
    const b = Math.min(len - 1, a + 1);
    const f = pos - a;
    out[i] = clamp01(clamp01(bins[a]) * (1 - f) + clamp01(bins[b]) * f);
  }
  return out;
}

export function createHistory(rows, bins = HISTORY_BINS) {
  const data = new Float32Array(rows * bins);
  let head = 0;
  return {
    rows,
    bins,
    data,
    get head() { return head; },
    push(spectrum) {
      data.set(resample(spectrum, bins), head * bins);
      head = (head + 1) % rows;
    },
    row(r) {
      const phys = (head + r) % rows;
      return data.subarray(phys * bins, (phys + 1) * bins);
    },
    clear() { data.fill(0); head = 0; },
  };
}

export function columnBin(col, cols, bins) {
  const x = cols <= 1 ? 0 : col / (cols - 1);
  return x * (bins - 1);
}

export function edgeFalloff(x) {
  return 1 - smoothstep(0.82, 1, Math.abs(x));
}

export function bassGain(x, bassWeight = 0.7) {
  return 1 + bassWeight * (1 - clamp01((x + 1) / 2)) ** 2;
}

export function swell(x, row, t, amp = 0.12) {
  return amp * (0.5 + 0.5 * Math.sin(x * 3.1 + row * 0.35 + t * 0.6)) * edgeFalloff(x);
}

export function heightAt(v, x, row = 0, t = 0, opts = {}) {
  const { gain = 1.15, swellAmp = 0.12, bassWeight = 0.7 } = opts;
  const base = smoothstep(0, 1, clamp01(v) * gain * bassGain(x, bassWeight) * 0.7) * edgeFalloff(x);
  return clamp01(base + swell(x, row, t, swellAmp) * (1 - base));
}

export function camClamp(v) {
  const num = (x, lim, d) => Math.min(lim[1], Math.max(lim[0], Number.isFinite(+x) && x !== null && x !== '' ? +x : d));
  return {
    eye: num(v?.eye, CAM_LIMITS.eye, EYE_HEIGHT),
    pitch: num(v?.pitch, CAM_LIMITS.pitch, defaultPitchDeg()),
    yaw: num(v?.yaw, CAM_LIMITS.yaw, 0),
    sync: Math.round(num(v?.sync, CAM_LIMITS.sync, 0)),
  };
}

export function camFormat(v) {
  const c = camClamp(v);
  return `eye=${c.eye.toFixed(2)} pitch=${c.pitch.toFixed(1)}deg yaw=${c.yaw.toFixed(1)}deg sync=${c.sync}ms`;
}

export function camParse(text) {
  const e = /eye\s*=\s*(-?[\d.]+)/.exec(text || '');
  const p = /pitch\s*=\s*(-?[\d.]+)/.exec(text || '');
  const sy = /sync\s*=\s*(-?[\d.]+)/.exec(text || '');
  const w = /yaw\s*=\s*(-?[\d.]+)/.exec(text || '');
  return camClamp({ eye: e ? e[1] : null, pitch: p ? p[1] : null, yaw: w ? w[1] : null, sync: sy ? sy[1] : null });
}

const nowNum = (x, key) => {
  const lim = NOW_LIMITS[key];
  const raw = typeof x === 'string' ? x.trim().replace(/x$/i, '').replace(',', '.') : x;
  const n = Number(raw);
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? NOW_DEFAULTS[key] : Math.min(lim[1], Math.max(lim[0], n));
};

export const nowClamp = (v) => ({ nowH: nowNum(v?.nowH, 'nowH'), nowB: nowNum(v?.nowB, 'nowB') });

export const nowFormat = (v) => {
  const c = nowClamp(v);
  return `nowH=${c.nowH.toFixed(2)} nowB=${c.nowB.toFixed(1)}`;
};

export function nowParse(text) {
  const out = {};
  const h = /nowH\s*=\s*(-?[\d.]+)/.exec(text || '');
  const b = /nowB\s*=\s*(-?[\d.]+)/.exec(text || '');
  if (h) out.nowH = nowNum(h[1], 'nowH');
  if (b) out.nowB = nowNum(b[1], 'nowB');
  return out;
}

export function parseNowField(text, key, last) {
  const raw = String(text ?? '').trim().replace(/x$/i, '').replace(',', '.');
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return last;
  return Math.min(NOW_LIMITS[key][1], Math.max(NOW_LIMITS[key][0], n));
}

export const defaultPitchDeg = () => DEFAULT_PITCH_DEG;

export function rowZ(row, rows) {
  return (GRID_DEPTH * row) / Math.max(1, rows - 1);
}

export function rowLayout(rows) {
  const dz = GRID_DEPTH / Math.max(1, rows - 1);
  return { dz, dt: dz / WORLD_SPEED, nowRow: Math.round(NOW_Z / dz) };
}

export const nowZOf = (rows) => {
  const l = rowLayout(rows);
  return l.nowRow * l.dz;
};

export function createFrame(rows, bins = HISTORY_BINS) {
  const data = new Float32Array(rows * bins);
  return { rows, bins, data, boost: new Float32Array(rows), cov: new Float32Array(rows).fill(1), row: (r) => data.subarray(r * bins, (r + 1) * bins) };
}

export function landmarkWeight(dt) {
  const d = Math.abs(dt);
  if (!(d < LANDMARK_SPREAD_S)) return 0;
  const sigma = LANDMARK_SPREAD_S / 2;
  const edge = Math.exp(-0.5 * (LANDMARK_SPREAD_S / sigma) ** 2);
  return (Math.exp(-0.5 * (d / sigma) ** 2) - edge) / (1 - edge);
}

export function rowPeak(row, n = row.length) {
  const r = Math.round(0.03 * n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += row[i];
  const mean = sum / n;
  let best = -1;
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    let acc = 0;
    for (let k = a; k <= b; k += 1) acc += row[k];
    acc /= b - a + 1;
    if (acc > best) { best = acc; at = i; }
  }
  return { at, x: n > 1 ? at / (n - 1) : 0.5, ratio: mean > 0 ? best / mean : 0 };
}

export function landmarkShape(x, x0) {
  const z = Math.abs(x - x0) / LANDMARK_SIGMA_X;
  if (z >= LANDMARK_REACH) return 0;
  const edge = Math.exp(-0.5 * LANDMARK_REACH * LANDMARK_REACH);
  return (Math.exp(-0.5 * z * z) - edge) / (1 - edge);
}

function byteRow(data, offset, bins, tmp) {
  for (let j = 0; j < bins; j += 1) tmp[j] = data[offset + j] / 255;
  return tmp;
}

export function timelineLandmarks(tl) {
  const st = tl.landmarks || (tl.landmarks = { next: 0, times: [] });
  const span = LANDMARK_PERIOD_S * tl.rps;
  const windows = Math.ceil(tl.total / span);
  const tmp = new Float32Array(tl.bins);
  while (st.next < windows) {
    const from = Math.round(st.next * span);
    const to = Math.min(tl.total, Math.round((st.next + 1) * span));
    if (Math.min(tl.total, tl.done) < to) break;
    let best = -1;
    let bestE = LANDMARK_MIN_ENERGY;
    for (let i = from; i < to; i += 1) {
      const e = energyOf(byteRow(tl.data, i * tl.bins, tl.bins, tmp));
      if (e > bestE) { bestE = e; best = i; }
    }
    if (best >= 0 && rowPeak(byteRow(tl.data, best * tl.bins, tl.bins, tmp), tl.bins).ratio < LANDMARK_MIN_PEAKINESS) best = -1;
    st.times.push(best < 0 ? NaN : best / tl.rps);
    st.next += 1;
  }
  return st.times;
}

function landmarkWindow(tl, k) {
  const span = LANDMARK_PERIOD_S * tl.rps;
  const from = Math.round(k * span);
  const to = Math.min(tl.total, Math.round((k + 1) * span));
  const cache = tl.lmExtra || (tl.lmExtra = new Map());
  if (cache.has(k)) return cache.get(k);
  if (!(from < tl.total) || uncoveredSpans(tl, from, to).length) return NaN;
  const tmp = new Float32Array(tl.bins);
  let best = -1;
  let bestE = LANDMARK_MIN_ENERGY;
  for (let i = from; i < to; i += 1) {
    const e = energyOf(byteRow(tl.data, i * tl.bins, tl.bins, tmp));
    if (e > bestE) { bestE = e; best = i; }
  }
  if (best >= 0 && rowPeak(byteRow(tl.data, best * tl.bins, tl.bins, tmp), tl.bins).ratio < LANDMARK_MIN_PEAKINESS) best = -1;
  const v = best < 0 ? NaN : best / tl.rps;
  cache.set(k, v);
  return v;
}

export function landmarkBoostAt(tl, t) {
  if (!(t > -LANDMARK_SPREAD_S)) return 0;
  const times = timelineLandmarks(tl);
  const k = Math.floor(t / LANDMARK_PERIOD_S);
  let w = 0;
  for (let i = Math.max(0, k - 1); i <= k + 1; i += 1) {
    const at = i < times.length ? times[i] : landmarkWindow(tl, i);
    if (at === at) w = Math.max(w, landmarkWeight(t - at));
  }
  return w;
}

export function applyLandmarks(out, rows, cols, boost) {
  for (let r = 0; r < rows; r += 1) {
    const w = boost[r];
    if (!(w > 0)) continue;
    const o = r * cols;
    let max = 0;
    for (let c = 0; c < cols; c += 1) if (out[o + c] > max) max = out[o + c];
    const world = max * AMP_MAX;
    if (!(world > 0)) continue;
    const target = softKnee(world * (1 + (LANDMARK_GAIN - 1) * w) + LANDMARK_BONUS * w, LANDMARK_MAX);
    const lift = Math.max(1, target / world) - 1;
    const x0 = rowPeak(out.subarray(o, o + cols), cols).x;
    for (let c = 0; c < cols; c += 1) out[o + c] *= 1 + lift * landmarkShape(cols <= 1 ? 0 : c / (cols - 1), x0);
  }
  return out;
}

export function createSeries(cap = LIVE_CAP, bins = HISTORY_BINS) {
  const times = new Float64Array(cap);
  const data = new Float32Array(cap * bins);
  const boosts = new Float32Array(cap);
  let count = 0;
  let head = 0;
  let winK = NaN;
  let winMax = 0;
  const phys = (i) => (head - count + i + cap * 2) % cap;
  const locate = (t) => {
    const last = phys(count - 1);
    if (t >= times[last]) return { a: last, b: last, f: 0 };
    if (t < times[phys(0)]) return null;
    let lo = 0;
    let hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[phys(mid)] <= t) lo = mid; else hi = mid;
    }
    const a = phys(lo);
    const b = phys(hi);
    return { a, b, f: (t - times[a]) / Math.max(1e-6, times[b] - times[a]) };
  };
  return {
    bins,
    get count() { return count; },
    push(spectrum, t) {
      times[head] = t;
      const row = resample(spectrum, bins);
      data.set(row, head * bins);
      const k = Math.floor(t / LANDMARK_PERIOD_S);
      if (k !== winK) { winK = k; winMax = 0; }
      const e = energyOf(row);
      winMax = Math.max(winMax, e);
      const keep = LANDMARK_LIVE_KEEP;
      boosts[head] = e >= LANDMARK_MIN_ENERGY && winMax > 0 && rowPeak(row).ratio >= LANDMARK_MIN_PEAKINESS ? clamp01((e / winMax - keep) / (1 - keep)) : 0;
      head = (head + 1) % cap;
      count = Math.min(cap, count + 1);
    },
    boostAt(t) {
      if (!count) return 0;
      const p = locate(t);
      return p ? boosts[p.a] * (1 - p.f) + boosts[p.b] * p.f : 0;
    },
    sample(t, out) {
      if (!count) { out.fill(0); return out; }
      const last = phys(count - 1);
      if (t >= times[last]) { out.set(data.subarray(last * bins, (last + 1) * bins)); return out; }
      if (t < times[phys(0)]) { out.fill(0); return out; }
      let lo = 0;
      let hi = count - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[phys(mid)] <= t) lo = mid; else hi = mid;
      }
      const a = phys(lo);
      const b = phys(hi);
      const f = (t - times[a]) / Math.max(1e-6, times[b] - times[a]);
      for (let j = 0; j < bins; j += 1) out[j] = data[a * bins + j] * (1 - f) + data[b * bins + j] * f;
      return out;
    },
    clear() { count = 0; head = 0; winK = NaN; winMax = 0; },
  };
}

export const TIMELINE_END_FADE_ROWS = 8;

export const EDGE_FADE_ROWS = 8;

function rangesOf(tl) {
  if (tl.ranges?.length) return tl.ranges;
  return tl.done > 0 ? [[0, Math.min(tl.total, tl.done)]] : [];
}

export function markRows(tl, from, to) {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(tl.total, Math.ceil(to));
  if (!(b > a)) return tl;
  const r = tl.ranges || (tl.ranges = []);
  const out = [];
  let lo = a;
  let hi = b;
  let placed = false;
  for (const [x, y] of r) {
    if (y < lo) out.push([x, y]);
    else if (x > hi) { if (!placed) { out.push([lo, hi]); placed = true; } out.push([x, y]); }
    else { lo = Math.min(lo, x); hi = Math.max(hi, y); }
  }
  if (!placed) out.push([lo, hi]);
  tl.ranges = out;
  tl.ver = (tl.ver || 0) + 1;
  tl.done = out.length && out[0][0] === 0 ? out[0][1] : 0;
  return tl;
}

export function uncoveredSpans(tl, from, to) {
  const out = [];
  let at = Math.max(0, Math.floor(from));
  const end = Math.min(tl.total, Math.ceil(to));
  for (const [x, y] of rangesOf(tl)) {
    if (y <= at) continue;
    if (x >= end) break;
    if (x > at) out.push([at, x]);
    at = Math.max(at, y);
    if (at >= end) break;
  }
  if (at < end) out.push([at, end]);
  return out;
}

export function timelineCovers(tl, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * tl.rps));
  const b = Math.min(tl.total, Math.ceil(t1 * tl.rps) + 1);
  return b <= a || uncoveredSpans(tl, a, b).length === 0;
}

export function coveredRows(tl) {
  let n = 0;
  for (const [x, y] of rangesOf(tl)) n += y - x;
  return n;
}

export function coverageWeight(tl, t, fade = EDGE_FADE_ROWS) {
  const x = t * tl.rps;
  if (!(x >= 0)) return 0;
  const i = Math.floor(x);
  for (const [a, b] of rangesOf(tl)) {
    if (i < a) return 0;
    if (i >= b) continue;
    const head = a > 0 ? (x - a) / fade : Infinity;
    const tail = b < tl.total ? (b - 1 - x) / fade : Infinity;
    const k = Math.max(0, Math.min(1, head, tail));
    return k * k * (3 - 2 * k);
  }
  return 0;
}

export function sampleTimeline(tl, t, out) {
  const bins = tl.bins;
  const x = t * tl.rps;
  const last = tl.total - 1;
  if (!(x >= 0) || last < 0 || x > last + TIMELINE_END_FADE_ROWS) { out.fill(0); return out; }
  const d = tl.data;
  if (x > last) {
    const g = 1 - smoothstep(0, TIMELINE_END_FADE_ROWS, x - last);
    for (let j = 0; j < bins; j += 1) out[j] = (d[last * bins + j] / 255) * g;
    return out;
  }
  const i = Math.floor(x);
  const f = x - i;
  const a = i * bins;
  const b = Math.min(last, i + 1) * bins;
  for (let j = 0; j < bins; j += 1) out[j] = (d[a + j] * (1 - f) + d[b + j] * f) / 255;
  return out;
}

export function fillTimeFrame(frame, tNow, sampler, nowRow, boostFn, covFn) {
  const { dt } = rowLayout(frame.rows);
  const pos = tNow / dt;
  const base = Math.floor(pos);
  for (let r = 0; r < frame.rows; r += 1) {
    const t = (base + r - nowRow) * dt;
    sampler(t, frame.row(r));
    if (frame.boost) frame.boost[r] = boostFn ? boostFn(t) : 0;
    if (frame.cov) frame.cov[r] = covFn ? covFn(t) : 1;
  }
  return { base, frac: pos - base };
}

export function fillLookFrame(frame, timeline, tNow) {
  return fillTimeFrame(frame, tNow, (t, out) => sampleTimeline(timeline, t, out), rowLayout(frame.rows).nowRow, (t) => landmarkBoostAt(timeline, t), (t) => coverageWeight(timeline, t));
}

export function fillLiveFrame(frame, series, tNow) {
  const { nowRow } = rowLayout(frame.rows);
  return fillTimeFrame(frame, tNow, (t, out) => (t > tNow ? out.fill(0) : series.sample(t, out)), nowRow, (t) => (t > tNow ? 0 : series.boostAt(t)));
}

export function blendFrames(a, b, k) {
  const out = a.data;
  const o = b.data;
  const bins = a.bins;
  const cov = b.cov;
  if (!cov) {
    for (let i = 0; i < out.length; i += 1) out[i] += (o[i] - out[i]) * k;
  } else {
    for (let r = 0; r < a.rows; r += 1) {
      const kr = k * cov[r];
      if (!(kr > 0)) continue;
      for (let i = r * bins, e = i + bins; i < e; i += 1) out[i] += (o[i] - out[i]) * kr;
    }
  }
  if (a.boost && b.boost) for (let i = 0; i < a.boost.length; i += 1) a.boost[i] += (b.boost[i] - a.boost[i]) * k * (cov ? cov[i] : 1);
  return a;
}

export const ridgeZ = (rows, tRidge, tNow) => nowZOf(rows) + (tRidge - tNow) * WORLD_SPEED;

export const gridHalfWidth = (aspect) => WIDTH_PER_ASPECT * Math.min(3.6, Math.max(0.4, Number.isFinite(aspect) ? aspect : 1.78));

export const halfWidthAt = (z, aspect) => gridHalfWidth(aspect);

export function nearEnvelope(depthFrac) {
  const t = smoothstep(0, NEAR_CALM, clamp01(depthFrac));
  return 0.12 + 0.88 * t;
}

let smoothScratch = new Float32Array(0);

export function smoothHeights(out, rows, cols, passes = 2) {
  if (smoothScratch.length < out.length) smoothScratch = new Float32Array(out.length);
  const tmp = smoothScratch;
  for (let n = 0; n < passes; n += 1) {
    for (let r = 0; r < rows; r += 1) {
      const o = r * cols;
      for (let c = 0; c < cols; c += 1) {
        const a = out[o + Math.max(0, c - 1)];
        const b = out[o + c];
        const d = out[o + Math.min(cols - 1, c + 1)];
        tmp[o + c] = (a + 2 * b + d) / 4;
      }
    }
    for (let r = 0; r < rows; r += 1) {
      const o = r * cols;
      const up = Math.max(0, r - 1) * cols;
      const dn = Math.min(rows - 1, r + 1) * cols;
      for (let c = 0; c < cols; c += 1) out[o + c] = (tmp[up + c] + 2 * tmp[o + c] + tmp[dn + c]) / 4;
    }
  }
  return out;
}

export function fillHeights(history, cols, t, out, opts) {
  const rows = history.rows;
  const bins = history.bins;
  for (let r = 0; r < rows; r += 1) {
    const src = history.row(r);
    const amp = opts?.bakeAmp ? (AMP_BASE + AMP_GAIN * energyOf(src)) / AMP_MAX : 1;
    for (let c = 0; c < cols; c += 1) {
      const x = cols <= 1 ? 0 : (c / (cols - 1)) * 2 - 1;
      const pos = columnBin(c, cols, bins);
      const a = Math.floor(pos);
      const b = Math.min(bins - 1, a + 1);
      const v = src[a] * (1 - (pos - a)) + src[b] * (pos - a);
      out[r * cols + c] = heightAt(v, x, r, t, opts) * amp;
    }
  }
  if (!opts || opts.smooth !== 0) smoothHeights(out, rows, cols, opts?.smooth ?? 2);
  if (opts?.bakeAmp && history.boost && opts.landmarks !== false) applyLandmarks(out, rows, cols, history.boost);
  return out;
}

export function fogDensity(depthFrac, worldHeight) {
  const far = smoothstep(FOG_NEAR, FOG_FAR, depthFrac);
  const low = 1 - smoothstep(FOG_H0, FOG_H1, worldHeight);
  return far * (FOG_LOW_MIN + (1 - FOG_LOW_MIN) * low);
}

export function lightFactor(slopeX, slopeZ, dir = LIGHT_DIR) {
  const inv = 1 / Math.hypot(slopeX, 1, slopeZ);
  const d = (-slopeX * dir[0] + dir[1] - slopeZ * dir[2]) * inv;
  const flat = dir[1];
  return d >= flat ? (d - flat) / (1 - flat) : (d - flat) / (1 + flat);
}

export function fillLight(heights, rows, cols, halfWidth, dz, out, amp = AMP_MAX, scratch = null) {
  const xs = scratch && scratch.length >= cols ? scratch : new Float32Array(cols);
  for (let c = 0; c < cols; c += 1) xs[c] = columnX(cols <= 1 ? 0 : c / (cols - 1)) * halfWidth;
  for (let r = 0; r < rows; r += 1) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(rows - 1, r + 1);
    for (let c = 0; c < cols; c += 1) {
      const c0 = Math.max(0, c - LIGHT_SPAN);
      const c1 = Math.min(cols - 1, c + LIGHT_SPAN);
      const sx = ((heights[r * cols + c1] - heights[r * cols + c0]) * amp) / Math.max(LIGHT_MIN_DX, xs[c1] - xs[c0]);
      const sr = ((heights[r1 * cols + c] - heights[r0 * cols + c]) * amp) / Math.max(1e-6, (r1 - r0) * dz);
      out[r * cols + c] = lightFactor(sx, -sr);
    }
  }
  return out;
}

export function gridCounts(rows, cols) {
  return {
    vertices: rows * cols,
    segments: rows * (cols - 1) + cols * (rows - 1),
  };
}

export function columnX(t) {
  const u = t * 2 - 1;
  return COL_SHAPE * u + (1 - COL_SHAPE) * u * u * u;
}

export function buildGridVertices(rows, cols) {
  const out = new Float32Array(rows * cols * 2);
  let k = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out[k++] = cols <= 1 ? 0 : columnX(c / (cols - 1));
      out[k++] = r;
    }
  }
  return out;
}

function lineIndices(rows, cols, depth) {
  const { vertices } = gridCounts(rows, cols);
  const n = depth ? cols * (rows - 1) : rows * (cols - 1);
  const out = vertices > 65535 ? new Uint32Array(n * 2) : new Uint16Array(n * 2);
  let k = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (depth && r < rows - 1) { out[k++] = i; out[k++] = i + cols; }
      if (!depth && c < cols - 1) { out[k++] = i; out[k++] = i + 1; }
    }
  }
  return out;
}

export const buildDepthIndices = (rows, cols) => lineIndices(rows, cols, true);
export const buildCrossIndices = (rows, cols) => lineIndices(rows, cols, false);

export function buildRibbonVertices(rows, cols) {
  const base = buildGridVertices(rows, cols);
  const n = rows * cols;
  const xz = new Float32Array(n * 4);
  const side = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    xz[i * 4] = base[i * 2];
    xz[i * 4 + 1] = base[i * 2 + 1];
    xz[i * 4 + 2] = base[i * 2];
    xz[i * 4 + 3] = base[i * 2 + 1];
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  return { xz, side };
}

export function buildRibbonIndices(rows, cols, depth) {
  const n = depth ? cols * (rows - 1) : rows * (cols - 1);
  const out = rows * cols * 2 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
  let k = 0;
  const quad = (i, j) => {
    out[k++] = 2 * i; out[k++] = 2 * i + 1; out[k++] = 2 * j;
    out[k++] = 2 * i + 1; out[k++] = 2 * j + 1; out[k++] = 2 * j;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (depth && r < rows - 1) quad(i, i + cols);
      if (!depth && c < cols - 1) quad(i, i + 1);
    }
  }
  return out;
}

export function buildLineIndices(rows, cols) {
  const d = buildDepthIndices(rows, cols);
  const c = buildCrossIndices(rows, cols);
  const out = new d.constructor(d.length + c.length);
  out.set(d);
  out.set(c, d.length);
  return out;
}

export function energyOf(spectrum) {
  const n = spectrum?.length || 0;
  if (!n) return 0;
  const bass = Math.min(6, n);
  let b = 0;
  let all = 0;
  for (let i = 0; i < n; i += 1) {
    const v = clamp01(spectrum[i]);
    all += v;
    if (i < bass) b += v;
  }
  return clamp01(0.55 * (b / bass) + 0.9 * (all / n));
}

export function easeEnergy(prev, target, dtSeconds) {
  const k = 1 - Math.exp(-(target > prev ? 6 : 1.6) * Math.max(0, Math.min(0.5, dtSeconds || 0)));
  return clamp01(prev + (target - prev) * k);
}

export const STAR_VISIBLE = [40, 90, 150];

export function colorRamp(h, out = [0, 0, 0]) {
  const v = clamp01(h);
  const hi = v <= RAMP[1].at ? 1 : 2;
  const a = RAMP[hi - 1];
  const b = RAMP[hi];
  const f = smoothstep(0, 1, (v - a.at) / (b.at - a.at));
  for (let i = 0; i < 3; i += 1) out[i] = a.c[i] + (b.c[i] - a.c[i]) * f;
  return out;
}

export function fillColors(heights, out) {
  const tmp = [0, 0, 0];
  for (let i = 0; i < heights.length; i += 1) {
    colorRamp(heights[i], tmp);
    out[i * 3] = tmp[0];
    out[i * 3 + 1] = tmp[1];
    out[i * 3 + 2] = tmp[2];
  }
  return out;
}

export const horizonGlow = (bass) => 0.35 + 0.65 * clamp01(bass);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeStars(seed, n) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = rnd() * 2 - 1;
    out[i * 3 + 1] = 0.1 + rnd() * 0.9;
    out[i * 3 + 2] = 0.25 + rnd() * 0.75;
  }
  return out;
}

export function cameraAt(t, bass = 0, opts = {}) {
  const { fly = 0.4, period = 60 } = opts;
  const camEye = Number.isFinite(opts.eye) ? opts.eye : EYE_HEIGHT;
  const pitchDeg = Number.isFinite(opts.pitchDeg) ? opts.pitchDeg : null;
  const yaw = (Number.isFinite(opts.yawDeg) ? opts.yawDeg : 0) * (Math.PI / 180);
  const shakeAmp = Math.min(SHAKE_MAX, clamp01(bass) * SHAKE_MAX);
  const shakeY = Math.sin(t * 41.7 + 1.3) * shakeAmp;
  const phase = (t / period) * Math.PI * 2;
  const forward = fly * (0.5 - 0.5 * Math.cos(phase));
  const fov = (62 + 3 * clamp01(bass)) * (Math.PI / 180);
  const eye = [0, camEye + 0.04 * Math.sin(t * 0.11) + shakeY, 0.7 - forward];
  const targetZ = -GRID_DEPTH * 0.75;
  const basePitch = pitchDeg === null ? DEFAULT_PITCH_DEG : pitchDeg;
  const slope = Math.tan((basePitch + 0.1 * Math.sin(t * 0.05)) * (Math.PI / 180));
  return {
    eye,
    target: yaw === 0
      ? [0, eye[1] + slope * (eye[2] - targetZ), targetZ]
      : [eye[0] + Math.sin(yaw) * (eye[2] - targetZ), eye[1] + slope * (eye[2] - targetZ), eye[2] - Math.cos(yaw) * (eye[2] - targetZ)],
    up: [0, 1, 0],
    fov,
  };
}

export function horizonY(cam) {
  const d = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const down = -Math.asin(Math.max(-1, Math.min(1, d[1] / len)));
  const ndc = Math.tan(down) / Math.tan(cam.fov / 2);
  return Math.min(0.95, Math.max(0.05, 0.5 + 0.5 * ndc));
}

export function mat4Perspective(fov, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4LookAt(eye, target, up, out = new Float32Array(16)) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function mat4Multiply(a, b, out = new Float32Array(16)) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let row = 0; row < 4; row += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  }
  out.set(r);
  return out;
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

export function makeRowClock(rate = ROWS_PER_SECOND, maxCatchUp = 4) {
  const gap = 1000 / rate;
  let last = null;
  return {
    advance(nowMs) {
      if (last === null || nowMs < last) { last = nowMs; return { pushes: 1, frac: 0 }; }
      let pushes = 0;
      while (nowMs - last >= gap && pushes < maxCatchUp) { last += gap; pushes += 1; }
      if (nowMs - last >= gap) last = nowMs;
      return { pushes, frac: clamp01((nowMs - last) / gap) };
    },
    reset() { last = null; },
  };
}

export const NOW_LINE_GAIN_H = 1.0;
export const NOW_LINE_GAIN_B = 2.0;
export const NOW_LINE_GAIN_H_FULL = 1.1;
export const NOW_LINE_GAIN_H_LAVA = 2.2;
export const NOW_LINE_GAIN_B_LAVA = 4.0;
export const NOW_LIMITS = { nowH: [1, 3], nowB: [0.5, 4] };
export const NOW_DEFAULTS = { nowH: NOW_LINE_GAIN_H_FULL, nowB: NOW_LINE_GAIN_B };
export const NOW_LINE_SIGMA_S = NOW_FALLOFF_S / Math.SQRT2;
export const NOW_LINE_REACH_S = 3 * NOW_LINE_SIGMA_S;
export const BEAT_BASE_RELIEF = 0.6;
export const FULL_BASE_RELIEF = 1.0;
const NOW_LINE_EDGE = Math.exp(-((NOW_LINE_REACH_S / NOW_FALLOFF_S) ** 2));

export function nowLineWeight(dtSec) {
  const d = Math.abs(dtSec);
  if (!(d < NOW_LINE_REACH_S)) return 0;
  return (Math.exp(-((d / NOW_FALLOFF_S) ** 2)) - NOW_LINE_EDGE) / (1 - NOW_LINE_EDGE);
}

export const nowLineBoost = (dtSec, gain = NOW_LINE_GAIN_H) => 1 + (gain - 1) * nowLineWeight(dtSec);

export function applyNowLine(out, rows, cols, frac, cap = HEIGHT_CAP, gain = NOW_LINE_GAIN_H) {
  const { dt, nowRow } = rowLayout(rows);
  const centre = nowRow + frac;
  const lo = Math.max(0, Math.floor(centre - NOW_LINE_REACH_S / dt));
  const hi = Math.min(rows - 1, Math.ceil(centre + NOW_LINE_REACH_S / dt));
  for (let r = lo; r <= hi; r += 1) {
    const g = nowLineBoost((r - centre) * dt, gain);
    if (g === 1) continue;
    const o = r * cols;
    for (let c = 0; c < cols; c += 1) out[o + c] = softKnee(out[o + c] * g, cap);
  }
  return out;
}

export function addBaseRelief(out, relief, k = BEAT_BASE_RELIEF, cap = HEIGHT_CAP) {
  for (let i = 0; i < out.length; i += 1) out[i] = softKnee(out[i] + relief[i] * k, cap);
  return out;
}

export function layerFullRelief(beats, relief, rows, cols, frac, gain = NOW_LINE_GAIN_H_FULL, share = null, cap = HEIGHT_CAP) {
  const { dt, nowRow } = rowLayout(rows);
  const centre = nowRow + frac;
  for (let r = 0; r < rows; r += 1) {
    const d = (r - centre) * dt;
    const g = Math.abs(d) < NOW_LINE_REACH_S ? nowLineBoost(d, gain) : 1;
    const o = r * cols;
    for (let c = 0; c < cols; c += 1) {
      const base = relief[o + c];
      const p = beats[o + c] * g;
      const out = p > 0 ? Math.min(Math.max(base, cap), base + softKnee(base + p, cap) - softKnee(base, cap)) : base;
      if (share) share[o + c] = out > base && out > 0 ? (out - base) / out : 0;
      beats[o + c] = out;
    }
  }
  return beats;
}

export function nowGains(cam, style) {
  const lava = style === 'lava';
  const dh = lava ? NOW_LINE_GAIN_H_LAVA : style === 'full' ? NOW_LINE_GAIN_H_FULL : NOW_LINE_GAIN_H;
  const db = lava ? NOW_LINE_GAIN_B_LAVA : NOW_LINE_GAIN_B;
  const h = cam?.nowH;
  const b = cam?.nowB;
  return {
    h: Number.isFinite(h) && h !== NOW_DEFAULTS.nowH ? h : dh,
    b: Number.isFinite(b) && b !== NOW_DEFAULTS.nowB ? b : db,
  };
}
