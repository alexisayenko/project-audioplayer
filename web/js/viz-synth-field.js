import {
  fillHeights, softKnee, smoothstep, clamp01, AMP_MAX, LANDMARK_MAX, GRID_DEPTH, rowLayout,
} from './viz-terrain-math.js';

const MEAN_FLOOR = 1e-6;
const FACET_COLS = 3;
const POOL_MAX = 0.2;
const FADE_TAU_S = 12;
let tmp = new Float32Array(0);
let full = new Float32Array(0);
const maskCache = new Map();

const need = (a, n) => (a.length < n ? new Float32Array(n) : a);
const lerp = (a, b, t) => a + (b - a) * t;

export function fadeDecay(fade) {
  const f = Number.isFinite(fade) ? Math.min(3, Math.max(0.2, fade)) : 1;
  return 1 / f;
}

export function valleyMask(cols, width) {
  const out = new Float32Array(cols);
  const w = Math.min(0.5, Math.max(0.01, Number.isFinite(width) ? width : 0.18));
  for (let c = 0; c < cols; c += 1) {
    const x = cols <= 1 ? 0 : Math.abs((c / (cols - 1)) * 2 - 1);
    out[c] = smoothstep(w * 0.5, w, x);
  }
  return out;
}

function maskFor(cols, width) {
  const key = `${cols}:${width}`;
  let m = maskCache.get(key);
  if (!m) {
    if (maskCache.size > 16) maskCache.clear();
    m = valleyMask(cols, width);
    maskCache.set(key, m);
  }
  return m;
}

function poolColumns(out, rows, cols, radius) {
  if (radius < 1 || cols < 3) return;
  tmp = need(tmp, cols);
  const span = 2 * radius + 1;
  for (let r = 0; r < rows; r += 1) {
    const o = r * cols;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += out[o + Math.min(cols - 1, Math.max(0, k))];
    for (let c = 0; c < cols; c += 1) {
      tmp[c] = sum / span;
      sum += out[o + Math.min(cols - 1, c + radius + 1)] - out[o + Math.max(0, c - radius)];
    }
    for (let c = 0; c < cols; c += 1) out[o + c] = tmp[c];
  }
}

function facet(out, rows, cols, weight) {
  if (!(weight > 0) || cols < FACET_COLS + 1) return; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  for (let r = 0; r < rows; r += 1) {
    const o = r * cols;
    let a = 0;
    while (a < cols - 1) {
      const b = Math.min(cols - 1, a + FACET_COLS);
      const va = out[o + a];
      const vb = out[o + b];
      for (let c = a + 1; c < b; c += 1) {
        const lin = lerp(va, vb, (c - a) / (b - a));
        out[o + c] = lerp(out[o + c], lin, weight);
      }
      a = b;
    }
  }
}

export function shapePeaks(out, rows, cols, sharp) {
  const n = rows * cols;
  const s = clamp01(Number.isFinite(sharp) ? sharp : 0.45);
  let m = 0;
  let sumIn = 0;
  for (let i = 0; i < n; i += 1) {
    const v = out[i];
    if (v > m) m = v;
    sumIn += v;
  }
  if (!(m > 0)) return out; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  const g = s <= 0.5 ? lerp(0.65, 1, s / 0.5) : lerp(1, 3, (s - 0.5) / 0.5);
  let sumOut = 0;
  for (let i = 0; i < n; i += 1) {
    const v = m * (out[i] / m) ** g;
    out[i] = v;
    sumOut += v;
  }
  facet(out, rows, cols, Math.max(0, 1 - Math.abs(s - 0.5) * 4));
  const k = Math.min(2, Math.max(0.6, (sumIn / Math.max(MEAN_FLOOR, sumOut)) ** 0.75));
  for (let i = 0; i < n; i += 1) out[i] = Math.min(m, out[i] * k);
  return out;
}

export function fillSynthHeights(frame, cols, t, p, out) {
  const rows = frame.rows;
  const d = clamp01(Number.isFinite(p.density) ? p.density : 0.5);
  fillHeights(frame, cols, t, out, { bakeAmp: true, smooth: Math.round((1 - d) * 4) });
  poolColumns(out, rows, cols, Math.round((1 - d) ** 2 * cols * POOL_MAX));
  shapePeaks(out, rows, cols, p.sharp);
  const k = AMP_MAX * (Number.isFinite(p.height) ? p.height : 1);
  const mask = p.valley ? maskFor(cols, p.valleyWidth) : null;
  const { dt, nowRow } = rowLayout(rows);
  const tau = FADE_TAU_S * fadeDecay(p.fade);
  for (let r = 0; r < rows; r += 1) {
    const o = r * cols;
    const g = k * Math.exp(-(Math.max(0, nowRow - r) * dt) / tau);
    for (let c = 0; c < cols; c += 1) {
      const v = out[o + c] * g * (mask ? mask[c] : 1);
      out[o + c] = softKnee(v, LANDMARK_MAX);
    }
  }
  return out;
}

export function futureLayout(rows, p) {
  const { dz, nowRow } = rowLayout(rows);
  const dist = Number.isFinite(p.futureDist) ? Math.min(1, Math.max(0.1, p.futureDist)) : 0.6;
  const n = Math.max(1, Math.min(rows - nowRow, Math.ceil((dist * GRID_DEPTH) / dz)));
  return { row0: nowRow, n, dz };
}

export function futureHeights(frame, cols, t, p, out, src = null) {
  const { row0, n } = futureLayout(frame.rows, p);
  let field = src;
  if (!field) {
    full = need(full, frame.rows * cols);
    field = fillSynthHeights(frame, cols, t, p, full);
  }
  out.set(field.subarray(row0 * cols, (row0 + n) * cols));
  return out;
}
