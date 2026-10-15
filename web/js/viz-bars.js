import { rgba, barStops } from './viz-color.js';
import { barHeight, edgeAlpha } from './viz-spectrum.js';
import {
  BAR_WIDTH_FRACTION, BAR_MIN_CSS, GAP_MIN_CSS, MIRROR_ALPHA, EDGE_BANDS, HORIZON_CORE_PX, HEIGHT_MAX, MAX_BAR_FRACTION,
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

export function segmentPlan(half, dpr, segments, gap) {
  const rows = Math.max(0, Math.floor(segments));
  if (!rows || !(half > 0)) return null;
  const pitch = (half * dpr) / rows;
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

function drawHalf(ctx, y0, geo, alpha, res, plan) {
  const { band, counts, alphas } = res.bands;
  const d = geo.dpr;
  const y0d = y0 * d;
  for (let b = 0; b < counts.length; b += 1) {
    if (!counts[b]) continue;
    ctx.globalAlpha = alpha * alphas[b];
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
        const [ry, rh] = segmentRect(r, y0d, plan);
        ctx.rect(x, ry, geo.barDev, rh);
      }
    }
    ctx.fill();
  }
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

function drawBackdrop(ctx, w, h, y0, colors, alpha) {
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
  const plan = segmentPlan(half, geo.dpr, segments, segmentGap);
  if (backdrop === 'ice') drawBackdrop(ctx, w, h, y0, colors, backdropAlpha);
  if (tips) stepTips(n, tipFade, half, dt);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = res.fill;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHalf(ctx, y0, geo, alpha, res, plan);
  if (tips) { drawTips(ctx, n, y0, geo, alpha, rgba(colors.line, 1), plan); ctx.fillStyle = res.fill; }
  ctx.translate(0, 2 * y0 * geo.dpr);
  ctx.scale(1, -1);
  drawHalf(ctx, y0, geo, alpha * reflection, res, plan);
  if (tips) drawTips(ctx, n, y0, geo, alpha * reflection, rgba(colors.line, 1), plan);
  ctx.restore();
  if (glow) drawHorizon(ctx, w, y0, res, alpha, band);
  ctx.restore();
}
