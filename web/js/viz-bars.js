import { rgba, barStops } from './viz-color.js';
import { barHeight, edgeAlpha } from './viz-spectrum.js';
import {
  BAR_WIDTH_FRACTION, BAR_MIN_CSS, GAP_MIN_CSS, MIRROR_ALPHA, EDGE_BANDS, HORIZON_CORE_PX, HEIGHT_MAX, MAX_BAR_FRACTION, PEAK_HOLD_S, PEAK_STEP_S, PEAK_ACCEL,
  SECTOR_MIN_COUNT, SECTOR_DT_MAX, SECTOR_LIFT,
} from './viz-constants.js';

export function mirror(half) {
  const n = half.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    out[n - 1 - i] = half[i];
    out[n + i] = half[i];
  }
  return out;
}

export function barGeometry(n, w, dpr = 1, fraction = BAR_WIDTH_FRACTION, minGapCss = GAP_MIN_CSS) {
  const d = Math.max(1, dpr);
  const pitch = w / n;
  const pitchDev = pitch * d;
  const widest = Math.max(1, Math.floor(pitchDev) - Math.ceil(minGapCss * d));
  const want = Math.max(Math.round(fraction * pitchDev), Math.ceil(BAR_MIN_CSS * d));
  const barDev = Math.max(1, Math.min(want, widest));
  return { pitch, width: barDev / d, dpr: d, pitchDev, barDev };
}

export function barRect(i, geo) {
  const left = Math.round(i * geo.pitchDev);
  return [left, left + geo.barDev];
}

export function edgeBands(n, w, geo, bands = EDGE_BANDS) {
  const band = new Uint8Array(n);
  const counts = new Array(bands).fill(0);
  const alphas = Array.from({ length: bands }, (_, b) => (b + 1) / bands);
  for (let i = 0; i < n; i += 1) {
    const a = edgeAlpha(i * geo.pitch + geo.width / 2, w);
    const b = Math.min(bands - 1, Math.max(0, Math.ceil(a * bands) - 1));
    band[i] = b;
    counts[b] += 1;
  }
  return { band, counts, alphas };
}

const NO_FX = { peak: 0, afterimage: 0, afterTau: 0.35, jitter: 0, baseGlow: 0, baseColor: '#fff' };

const cache = new WeakMap();
let heights = new Float32Array(0);

function resources(ctx, w, n, geo, colors, vertical) {
  const key = `${w}|${n}|${geo.barDev}|${geo.dpr}|${colors.stops ?? [colors.a, colors.b]}|${colors.line}|${vertical ? `${vertical.y0}/${vertical.half}` : ''}`;
  const hit = cache.get(ctx);
  if (hit && hit.key === key) return hit;
  const fill = vertical
    ? ctx.createLinearGradient(0, vertical.y0 * geo.dpr, 0, (vertical.y0 - vertical.half) * geo.dpr)
    : ctx.createLinearGradient(0, 0, w * geo.dpr, 0);
  for (const s of barStops(colors)) fill.addColorStop(s.at, rgba(s.color, 1));
  const flare = ctx.createLinearGradient(0, 0, w, 0);
  flare.addColorStop(0, rgba(colors.line, 0.45));
  flare.addColorStop(0.5, rgba(colors.line, 1));
  flare.addColorStop(1, rgba(colors.line, 0.45));
  const next = { key, fill, flare, bands: edgeBands(n, w, geo) };
  cache.set(ctx, next);
  return next;
}

export function segmentPlan(half, dpr, segments, gap, sectionPx = 0) {
  if (!(half > 0)) return null;
  const fixed = sectionPx > 0;
  const rows = fixed ? Math.floor((half * dpr) / (sectionPx * dpr)) : Math.max(0, Math.floor(segments));
  if (!rows) return null;
  const pitch = fixed ? sectionPx * dpr : (half * dpr) / rows;
  const gapPx = Math.min(Math.max(1, Math.round(pitch * gap)), Math.max(0, Math.round(pitch) - 1));
  return { rows, pitch, gapPx };
}

export function litRows(heightCss, dpr, plan) {
  return Math.min(plan.rows, Math.max(0, Math.round((heightCss * dpr) / plan.pitch)));
}

function segmentRect(r, y0d, plan) {
  const top = Math.round(y0d - (r + 1) * plan.pitch);
  const bottom = Math.round(y0d - r * plan.pitch);
  return [top + plan.gapPx, Math.max(1, bottom - top - plan.gapPx)];
}

let markers = new Int16Array(0);
let holds = new Float32Array(0);
let falls = new Float32Array(0);
let steps = new Uint8Array(0);
let since = new Float32Array(0);
const peakState = { n: 0, rows: 0 };
const AFTER_BINS = 4;

export function resetPeak() {
  peakState.n = 0;
  peakState.rows = 0;
}

export const markerRow = (i) => markers[i];
export const afterAge = (i, r) => since[i * peakState.rows + r];
export const afterAlpha = (age, tau) => Math.exp(-Math.max(0, age) / Math.max(1e-3, tau));

export function stepPeak(n, plan, dpr, dt, hold = PEAK_HOLD_S) {
  if (!plan) return;
  if (peakState.n !== n || peakState.rows !== plan.rows) {
    if (markers.length < n) { markers = new Int16Array(n); holds = new Float32Array(n); falls = new Float32Array(n); steps = new Uint8Array(n); }
    if (since.length < n * plan.rows) since = new Float32Array(n * plan.rows);
    markers.fill(-1);
    holds.fill(0);
    falls.fill(0);
    steps.fill(0);
    since.fill(1e3);
    peakState.n = n;
    peakState.rows = plan.rows;
  }
  if (!(dt > 0)) return;
  for (let i = 0; i < n; i += 1) {
    const top = (heights[i] > 0 ? litRows(heights[i], dpr, plan) : 0) - 1;
    if (top >= markers[i]) {
      markers[i] = top;
      holds[i] = 0;
      falls[i] = 0;
      steps[i] = 0;
    } else {
      holds[i] += dt;
      if (holds[i] > hold) {
        falls[i] += dt;
        let interval = PEAK_STEP_S * PEAK_ACCEL ** steps[i];
        while (falls[i] >= interval && markers[i] > top) {
          falls[i] -= interval;
          markers[i] -= 1;
          steps[i] = Math.min(20, steps[i] + 1);
          interval = PEAK_STEP_S * PEAK_ACCEL ** steps[i];
        }
      }
    }
    const base = i * plan.rows;
    for (let r = 0; r < plan.rows; r += 1) since[base + r] = r === markers[i] && markers[i] > top ? 0 : since[base + r] + dt;
  }
}

let visits = new Float32Array(0);
let sectorRow = new Int16Array(0);
let dwell = new Float32Array(0);
let counted = new Uint8Array(0);
let trailList = new Int32Array(0);
const trailStart = new Int32Array(16);
const trailPos = new Int32Array(16);
const sectorState = { key: '', n: 0, rows: 0 };

export function resetSector() {
  sectorState.key = '';
}

export const visitCount = (i, r) => visits[i * sectorState.rows + r];
export const currentSector = (i) => sectorRow[i];
export const trailLevel = (count, visitsPerStep, maxLevel) => Math.min(maxLevel, Math.floor(count / visitsPerStep));
export const trailAlpha = (level, maxLevel, trailMax) => Math.min(trailMax, 0.15 + 0.7 * (level / maxLevel));
export const trailLift = (level, stepGain, trailMax) => Math.min(SECTOR_LIFT * trailMax, level * stepGain);

export function stepSector(n, plan, dpr, dt, key, o) {
  if (!plan) return;
  const rows = plan.rows;
  if (sectorState.key !== key || sectorState.n !== n || sectorState.rows !== rows) {
    if (visits.length < n * rows) { visits = new Float32Array(n * rows); trailList = new Int32Array(n * rows); }
    if (sectorRow.length < n) { sectorRow = new Int16Array(n); dwell = new Float32Array(n); counted = new Uint8Array(n); }
    visits.fill(0);
    sectorRow.fill(-1);
    dwell.fill(0);
    counted.fill(0);
    trailStart.fill(0);
    sectorState.key = key;
    sectorState.n = n;
    sectorState.rows = rows;
  }
  if (!(dt > 0)) return;
  const step = Math.min(SECTOR_DT_MAX, dt);
  const leak = o.loss * step;
  const levels = o.maxLevel + 1;
  trailStart.fill(0);
  for (let i = 0; i < n; i += 1) {
    const row = heights[i] > 0 ? Math.min(rows - 1, Math.floor((heights[i] * dpr) / plan.pitch)) : -1;
    const base = i * rows;
    if (leak > 0) for (let r = 0; r < rows; r += 1) { const v = visits[base + r]; if (v > 0) visits[base + r] = v > leak ? v - leak : 0; }
    if (row !== sectorRow[i]) {
      sectorRow[i] = row;
      dwell[i] = 0;
      counted[i] = 0;
    }
    if (row >= 0 && !counted[i]) {
      dwell[i] += step;
      if (dwell[i] + 1e-6 >= o.minDwell) {
        visits[base + row] += 1;
        counted[i] = 1;
      }
    }
    for (let r = 0; r < rows; r += 1) {
      const v = visits[base + r];
      if (v >= SECTOR_MIN_COUNT) trailStart[trailLevel(v, o.visitsPerStep, o.maxLevel) + 1] += 1;
    }
  }
  for (let k = 1; k <= levels; k += 1) trailStart[k] += trailStart[k - 1];
  for (let k = 0; k < levels; k += 1) trailPos[k] = trailStart[k];
  for (let i = 0; i < n; i += 1) {
    const base = i * rows;
    for (let r = 0; r < rows; r += 1) {
      const v = visits[base + r];
      if (v >= SECTOR_MIN_COUNT) trailList[trailPos[trailLevel(v, o.visitsPerStep, o.maxLevel)]++] = base + r;
    }
  }
}

function drawSector(ctx, b, band, y0d, geo, alpha, plan, fx, reflected) {
  const rows = plan.rows;
  const x = (i) => barRect(i, geo)[0];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let k = 0; k <= fx.maxLevel; k += 1) {
      const a = trailAlpha(k, fx.maxLevel, fx.trailMax);
      const lift = trailLift(k, fx.stepGain, fx.trailMax);
      if (pass === 1 && !(lift > 0)) continue;
      ctx.globalAlpha = pass === 0 ? alpha * a : alpha * a * lift;
      if (pass === 1) ctx.fillStyle = fx.liftColor;
      ctx.beginPath();
      for (let e = trailStart[k]; e < trailStart[k + 1]; e += 1) {
        const cell = trailList[e];
        const i = (cell / rows) | 0;
        const r = cell - i * rows;
        if (band[i] !== b || r === sectorRow[i]) continue;
        const [ry, rh] = segmentRect(r, y0d, plan);
        ctx.rect(x(i), ry, geo.barDev, rh);
      }
      ctx.fill();
    }
    ctx.globalAlpha = pass === 0 ? alpha : alpha * SECTOR_LIFT;
    if (pass === 1) ctx.fillStyle = fx.liftColor;
    ctx.beginPath();
    for (let i = 0; i < band.length; i += 1) {
      const r = sectorRow[i];
      if (band[i] !== b || r < 0) continue;
      const [ry, rh] = segmentRect(r, y0d, plan);
      ctx.rect(x(i), ry, geo.barDev, rh);
    }
    ctx.fill();
    if (pass === 1) ctx.fillStyle = fx.fill;
  }
  if (reflected) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = fx.liftColor;
  ctx.lineWidth = Math.max(1, Math.round(geo.dpr));
  ctx.beginPath();
  for (let i = 0; i < band.length; i += 1) {
    const r = sectorRow[i];
    if (band[i] !== b || r < 0) continue;
    const [ry, rh] = segmentRect(r, y0d, plan);
    ctx.rect(x(i), ry, geo.barDev, rh);
  }
  ctx.stroke();
}

const JITTER_LEVELS = [-1, -0.5, 0, 0.5, 1];

export function jitterLevel(i, r) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(r + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) % 5;
}

function drawHalf(ctx, y0, geo, alpha, res, plan, fx = NO_FX, reflected = false) {
  const { band, counts, alphas } = res.bands;
  const d = geo.dpr;
  const y0d = y0 * d;
  const jit = plan && fx.jitter > 0;
  for (let b = 0; b < counts.length; b += 1) {
    if (!counts[b]) continue;
    if (plan && fx.sector) {
      drawSector(ctx, b, band, y0d, geo, alpha * alphas[b], plan, fx, reflected);
      if (fx.baseGlow > 0) drawBaseRow(ctx, b, band, y0d, geo, alpha * alphas[b], res, plan, fx);
      continue;
    }
    const levels = jit ? 5 : 1;
    for (let k = 0; k < levels; k += 1) {
      ctx.globalAlpha = jit ? Math.min(1, alpha * alphas[b] * (1 + JITTER_LEVELS[k] * fx.jitter)) : alpha * alphas[b];
      ctx.beginPath();
      for (let i = 0; i < band.length; i += 1) {
        if (band[i] !== b || !(heights[i] > 0)) continue;
        const x = barRect(i, geo)[0];
        if (!plan) {
          ctx.rect(x, (y0 - heights[i]) * d, geo.barDev, heights[i] * d);
          continue;
        }
        const lit = litRows(heights[i], d, plan);
        for (let r = 0; r < lit; r += 1) {
          if (jit && jitterLevel(i, r) !== k) continue;
          const [ry, rh] = segmentRect(r, y0d, plan);
          ctx.rect(x, ry, geo.barDev, rh);
        }
      }
      ctx.fill();
    }
    if (plan && fx.peak > 0 && peakState.rows === plan.rows) drawPeak(ctx, b, band, y0d, geo, alpha * alphas[b], plan, fx);
    if (plan && fx.baseGlow > 0) drawBaseRow(ctx, b, band, y0d, geo, alpha * alphas[b], res, plan, fx);
  }
}

function drawPeak(ctx, b, band, y0d, geo, alpha, plan, fx) {
  const d = geo.dpr;
  const rows = plan.rows;
  if (fx.afterimage > 0) {
    for (let k = 0; k < AFTER_BINS; k += 1) {
      const lo = k / AFTER_BINS;
      ctx.globalAlpha = alpha * fx.afterimage * ((k + 0.5) / AFTER_BINS);
      ctx.beginPath();
      for (let i = 0; i < band.length; i += 1) {
        if (band[i] !== b) continue;
        const x = barRect(i, geo)[0];
        const lit = heights[i] > 0 ? litRows(heights[i], d, plan) : 0;
        for (let r = lit; r < rows; r += 1) {
          if (r === markers[i]) continue;
          const a = afterAlpha(since[i * rows + r], fx.afterTau);
          if (a < 0.02 || a < lo || a >= lo + 1 / AFTER_BINS + (k === AFTER_BINS - 1 ? 1 : 0)) continue;
          const [ry, rh] = segmentRect(r, y0d, plan);
          ctx.rect(x, ry, geo.barDev, rh);
        }
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = alpha * fx.peak;
  ctx.beginPath();
  for (let i = 0; i < band.length; i += 1) {
    if (band[i] !== b) continue;
    const m = markers[i];
    const lit = heights[i] > 0 ? litRows(heights[i], d, plan) : 0;
    if (m < lit || m >= rows) continue;
    const [ry, rh] = segmentRect(m, y0d, plan);
    ctx.rect(barRect(i, geo)[0], ry, geo.barDev, rh);
  }
  ctx.fill();
}

function drawBaseRow(ctx, b, band, y0d, geo, alpha, res, plan, fx) {
  const d = geo.dpr;
  const [ry, rh] = segmentRect(0, y0d, plan);
  const grow = Math.max(1, Math.round(3 * d));
  ctx.fillStyle = fx.baseColor;
  for (const [pad, a] of [[grow, 0.18], [0, 1]]) {
    ctx.globalAlpha = alpha * a * fx.baseGlow;
    ctx.beginPath();
    for (let i = 0; i < band.length; i += 1) {
      if (band[i] !== b || litRows(Math.max(0, heights[i]), d, plan) < 1) continue;
      ctx.rect(barRect(i, geo)[0] - pad, ry - pad, geo.barDev + pad * 2, rh + pad * 2);
    }
    ctx.fill();
  }
  ctx.fillStyle = res.fill;
}

let peaks = new Float32Array(0);

export function stepTips(n, fade, half, dt) {
  if (peaks.length < n) peaks = new Float32Array(n);
  const drop = fade * half * dt;
  for (let i = 0; i < n; i += 1) peaks[i] = Math.max(heights[i], peaks[i] - drop);
  return peaks;
}

export function resetTips() { peaks = new Float32Array(0); }

function drawTips(ctx, n, y0, geo, alpha, color, plan) {
  const d = geo.dpr;
  const y0d = y0 * d;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const thick = Math.max(2, Math.round(2 * d));
  for (let i = 0; i < n; i += 1) {
    if (!(peaks[i] > 0)) continue;
    const x = barRect(i, geo)[0];
    if (plan) {
      const r = litRows(peaks[i], d, plan);
      if (r >= plan.rows) continue;
      const [ry, rh] = segmentRect(r, y0d, plan);
      ctx.rect(x, ry, geo.barDev, rh);
    } else {
      ctx.rect(x, Math.round(y0d - peaks[i] * d) - thick - 1, geo.barDev, thick);
    }
  }
  ctx.fill();
}

function drawHorizon(ctx, w, y0, res, alpha, band = 0) {
  ctx.fillStyle = res.flare;
  const layers = [[10, 0.2], [3, 0.5], [HORIZON_CORE_PX / 2, 1]];
  if (band > 0) layers.unshift([6 + band * 22, 0.18 * band], [3 + band * 7, 0.45 * band]);
  for (const [r, a] of layers) {
    ctx.globalAlpha = alpha * a;
    ctx.fillRect(0, y0 - r, w, r * 2);
  }
}

export function barHeights(values, half, out = heights) {
  const n = values.length;
  const arr = out.length >= n ? out : new Float32Array(n);
  for (let i = 0; i < n; i += 1) arr[i] = barHeight(values[i]) * half;
  return arr;
}

const BACKDROP_KEY = new WeakMap();

function drawBackdrop(ctx, w, h, y0, colors, alpha, kind = 'ice') {
  if (kind === 'black' || (kind === 'ice2' && colors.ice2)) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = kind === 'ice2' ? rgba(colors.ice2.bg, 1) : '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const ice = colors.ice;
  if (!ice?.bgTop) return;
  const key = `${h}|${y0}|${ice.bgTop}|${ice.bgMid}`;
  let hit = BACKDROP_KEY.get(ctx);
  if (!hit || hit.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(ice.bgTop, 1));
    g.addColorStop(y0 / h, rgba(ice.bgMid, 1));
    g.addColorStop(1, rgba(ice.bgTop, 1));
    hit = { key, g };
    BACKDROP_KEY.set(ctx, hit);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hit.g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export function drawBars(ctx, w, h, values, opts) {
  const {
    colors, horizon = 0.5, span = 1, alpha = 1, dpr = 1, widthFraction = BAR_WIDTH_FRACTION, minGapCss = GAP_MIN_CSS, maxHeightPx = 0, reflection = MIRROR_ALPHA, glow = true,
    direction = 'horizontal', segments = 0, segmentGap = 0.3, tips = false, tipFade = 0.3, band = 0, backdrop = 'none', backdropAlpha = 1, dt = 1 / 30,
    sectionHeight = 0, shadeJitter = 0, peak = 0, peakHold = PEAK_HOLD_S, afterimage = 0, afterTau = 0.35, peakDt = 0, baseGlow = 0, mirrorGap = 0, reflectionBlur = 0, tilt = 0,
    sectorMode = 'off', visitsPerStep = 5, loss = 1, maxLevel = 6, trailMax = 0.8, stepGain = 0.14, minDwell = 60,
  } = opts;
  const n = values.length;
  if (!n || !(w > 0) || !(h > 0)) return;
  const y0 = h * horizon;
  const avail = Math.min(y0, h - y0) * span;
  const half = maxHeightPx > 0 ? Math.min(maxHeightPx, MAX_BAR_FRACTION * avail) / HEIGHT_MAX : avail;
  const geo = barGeometry(n, w, dpr, widthFraction, minGapCss);
  if (heights.length < n) heights = new Float32Array(n);
  barHeights(values, half, heights);
  const vertical = direction === 'vertical' ? { y0, half } : null;
  const res = resources(ctx, w, n, geo, colors, vertical);
  const plan = segmentPlan(half, geo.dpr, segments, segmentGap, sectionHeight);
  const sector = sectorMode === 'trail' && !!plan;
  const fx = { jitter: shadeJitter, baseGlow, baseColor: rgba(colors.line, 1), peak: sector ? 0 : peak, afterimage: sector ? 0 : afterimage, afterTau, sector, maxLevel, trailMax, stepGain, liftColor: '#fff', fill: res.fill };
  if (sector) stepSector(n, plan, geo.dpr, peakDt, `${w}|${h}|${geo.dpr}|${visitsPerStep}|${maxLevel}`, { loss, visitsPerStep, maxLevel, minDwell: minDwell / 1000 });
  else if ((peak > 0 || afterimage > 0) && plan) stepPeak(n, plan, geo.dpr, peakDt, peakHold);
  if (backdrop === 'ice' || backdrop === 'black' || backdrop === 'ice2') drawBackdrop(ctx, w, h, y0, colors, backdropAlpha, backdrop);
  if (tips) stepTips(n, tipFade, half, dt);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = res.fill;
  const rad = tilt ? (-tilt * Math.PI) / 180 : 0;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w * geo.dpr) / 2;
  const cy = (h * geo.dpr) / 2;
  ctx.save();
  if (rad) ctx.setTransform(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy);
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHalf(ctx, y0, geo, alpha, res, plan, fx);
  if (tips) { drawTips(ctx, n, y0, geo, alpha, rgba(colors.line, 1), plan); ctx.fillStyle = res.fill; }
  ctx.translate(0, 2 * y0 * geo.dpr + Math.round(mirrorGap * geo.dpr));
  ctx.scale(1, -1);
  drawHalf(ctx, y0, geo, alpha * reflection, res, plan, fx, true);
  if (reflectionBlur > 0) {
    const k = Math.max(1, Math.round((1 + reflectionBlur * 3) * geo.dpr));
    const soft = alpha * reflection * 0.4 * reflectionBlur;
    ctx.translate(0, k);
    drawHalf(ctx, y0, geo, soft, res, plan, sector ? fx : NO_FX, true);
    ctx.translate(0, -2 * k);
    drawHalf(ctx, y0, geo, soft, res, plan, sector ? fx : NO_FX, true);
  }
  if (tips) drawTips(ctx, n, y0, geo, alpha * reflection, rgba(colors.line, 1), plan);
  ctx.restore();
  if (glow) {
    if (rad) { ctx.translate(w / 2, h / 2); ctx.rotate(rad); ctx.translate(-w / 2, -h / 2); }
    drawHorizon(ctx, w, y0, res, alpha, band);
  }
  ctx.restore();
}
