import { rgba, barStops } from './viz-color.js';
import { barHeight, edgeAlpha } from './viz-spectrum.js';
import {
  BAR_WIDTH_FRACTION, BAR_MIN_CSS, GAP_MIN_CSS, MIRROR_ALPHA, EDGE_BANDS, HORIZON_CORE_PX,
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

export function barGeometry(n, w, dpr = 1) {
  const d = Math.max(1, dpr);
  const pitch = w / n;
  const pitchDev = pitch * d;
  const widest = Math.max(1, Math.floor(pitchDev) - Math.ceil(GAP_MIN_CSS * d));
  const want = Math.max(Math.round(BAR_WIDTH_FRACTION * pitchDev), Math.ceil(BAR_MIN_CSS * d));
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

function resources(ctx, w, n, geo, colors) {
  const key = `${w}|${n}|${geo.barDev}|${geo.dpr}|${colors.stops ?? [colors.a, colors.b]}|${colors.line}`;
  const hit = cache.get(ctx);
  if (hit && hit.key === key) return hit;
  const fill = ctx.createLinearGradient(0, 0, w * geo.dpr, 0);
  for (const s of barStops(colors)) fill.addColorStop(s.at, rgba(s.color, 1));
  const flare = ctx.createLinearGradient(0, 0, w, 0);
  flare.addColorStop(0, rgba(colors.line, 0.45));
  flare.addColorStop(0.5, rgba(colors.line, 1));
  flare.addColorStop(1, rgba(colors.line, 0.45));
  const next = { key, fill, flare, bands: edgeBands(n, w, geo) };
  cache.set(ctx, next);
  return next;
}

function drawHalf(ctx, y0, geo, alpha, res) {
  const { band, counts, alphas } = res.bands;
  const d = geo.dpr;
  for (let b = 0; b < counts.length; b += 1) {
    if (!counts[b]) continue;
    ctx.globalAlpha = alpha * alphas[b];
    ctx.beginPath();
    for (let i = 0; i < band.length; i += 1) {
      if (band[i] === b && heights[i] > 0) {
        ctx.rect(barRect(i, geo)[0], (y0 - heights[i]) * d, geo.barDev, heights[i] * d);
      }
    }
    ctx.fill();
  }
}

function drawHorizon(ctx, w, y0, res, alpha) {
  ctx.fillStyle = res.flare;
  const layers = [[10, 0.2], [3, 0.5], [HORIZON_CORE_PX / 2, 1]];
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

export function drawBars(ctx, w, h, values, opts) {
  const { colors, horizon = 0.5, span = 1, alpha = 1, dpr = 1 } = opts;
  const n = values.length;
  if (!n || !(w > 0) || !(h > 0)) return;
  const y0 = h * horizon;
  const half = Math.min(y0, h - y0) * span;
  const geo = barGeometry(n, w, dpr);
  if (heights.length < n) heights = new Float32Array(n);
  barHeights(values, half, heights);
  const res = resources(ctx, w, n, geo, colors);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = res.fill;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHalf(ctx, y0, geo, alpha, res);
  ctx.translate(0, 2 * y0 * geo.dpr);
  ctx.scale(1, -1);
  drawHalf(ctx, y0, geo, alpha * MIRROR_ALPHA, res);
  ctx.restore();
  drawHorizon(ctx, w, y0, res, alpha);
  ctx.restore();
}
