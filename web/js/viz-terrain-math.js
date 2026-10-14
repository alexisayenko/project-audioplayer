export const QUALITY = [
  { rows: 48, cols: 72, bloom: false, smoke: 0, passes: 1 },
  { rows: 80, cols: 120, bloom: false, smoke: 2, passes: 3 },
  { rows: 104, cols: 160, bloom: true, smoke: 3, passes: 3 },
];
export const HISTORY_BINS = 64;
export const ROWS_PER_SECOND = 16;
export const SHAKE_MAX = 0.03;
export const GRID_DEPTH = 12;
export const HORIZON_TARGET = 0.57;
export const EYE_HEIGHT = 1.6;
export const CAM_LIMITS = { eye: [0.2, 4], pitch: [-30, 15] };
export const NEAR_CALM = 0.35;
export const GRID_HALF_WIDTH = 4.5;
export const RAMP = [
  { at: 0, c: [0.02, 0.05, 0.14] },
  { at: 0.45, c: [0.12, 0.55, 0.85] },
  { at: 1, c: [0.9, 0.98, 1] },
];

export const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function qualityFor(level) {
  const i = Number.isFinite(level) ? Math.min(QUALITY.length - 1, Math.max(0, Math.round(level))) : 1;
  return QUALITY[i];
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
  };
}

export function camFormat(v) {
  const c = camClamp(v);
  return `eye=${c.eye.toFixed(2)} pitch=${c.pitch.toFixed(1)}deg`;
}

export function camParse(text) {
  const e = /eye\s*=\s*(-?[\d.]+)/.exec(text || '');
  const p = /pitch\s*=\s*(-?[\d.]+)/.exec(text || '');
  return camClamp({ eye: e ? e[1] : null, pitch: p ? p[1] : null });
}

export function defaultPitchDeg(fovDeg = 62) {
  const ndc = (HORIZON_TARGET - 0.5) * 2;
  return -Math.atan(ndc * Math.tan((fovDeg * Math.PI) / 360)) * (180 / Math.PI);
}

export function nearEnvelope(depthFrac) {
  const t = smoothstep(0, NEAR_CALM, clamp01(depthFrac));
  return 0.12 + 0.88 * t;
}

export function smoothHeights(out, rows, cols, passes = 2) {
  const tmp = new Float32Array(out.length);
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
    for (let c = 0; c < cols; c += 1) {
      const x = cols <= 1 ? 0 : (c / (cols - 1)) * 2 - 1;
      const pos = columnBin(c, cols, bins);
      const a = Math.floor(pos);
      const b = Math.min(bins - 1, a + 1);
      const v = src[a] * (1 - (pos - a)) + src[b] * (pos - a);
      out[r * cols + c] = heightAt(v, x, r, t, opts);
    }
  }
  if (!opts || opts.smooth !== 0) smoothHeights(out, rows, cols, opts?.smooth ?? 2);
  return out;
}

export function gridCounts(rows, cols) {
  return {
    vertices: rows * cols,
    segments: rows * (cols - 1) + cols * (rows - 1),
  };
}

export function buildGridVertices(rows, cols) {
  const out = new Float32Array(rows * cols * 2);
  let k = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out[k++] = cols <= 1 ? 0 : (c / (cols - 1)) * 2 - 1;
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
  const shakeAmp = Math.min(SHAKE_MAX, clamp01(bass) * SHAKE_MAX);
  const shakeX = Math.sin(t * 37.1) * shakeAmp;
  const shakeY = Math.sin(t * 41.7 + 1.3) * shakeAmp;
  const phase = (t / period) * Math.PI * 2;
  const forward = fly * (0.5 - 0.5 * Math.cos(phase));
  const drift = 0.6 * Math.sin(t * 0.07);
  const fov = (62 + 3 * clamp01(bass)) * (Math.PI / 180);
  const eye = [drift + shakeX, camEye + 0.04 * Math.sin(t * 0.11) + shakeY, 0.7 - forward];
  const targetZ = -GRID_DEPTH * 0.75;
  const basePitch = pitchDeg === null ? defaultPitchDeg(fov * (180 / Math.PI)) : pitchDeg;
  const slope = Math.tan((basePitch + 0.1 * Math.sin(t * 0.05)) * (Math.PI / 180));
  return {
    eye,
    target: [drift * 0.4, eye[1] + slope * (eye[2] - targetZ), targetZ],
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
