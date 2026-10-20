import { fetchWhenReady } from './api.js';

export const CLIENT_DECODE_MAX = 12 * 1024 * 1024;
export const BUCKETS = 1200;

const q = encodeURIComponent;

export function validPeaks(p) {
  return !!p && p.v === 1 && Number.isInteger(p.buckets) && p.buckets > 0
    && Array.isArray(p.min) && Array.isArray(p.max) && p.min.length === p.buckets && p.max.length === p.buckets
    && typeof p.duration === 'number' && p.duration > 0;
}

export function reducePeaks(samples, sampleRate, buckets = BUCKETS) {
  const n = samples.length;
  if (!n) return null;
  const count = Math.min(buckets, n);
  const min = new Array(count);
  const max = new Array(count);
  let top = 0;
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * n) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * n) / count));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
    top = Math.max(top, Math.abs(lo), Math.abs(hi));
  }
  const scale = top > 0 ? 127 / top : 0;
  return { v: 1, buckets: count, duration: n / sampleRate, min: min.map((x) => Math.round(x * scale)), max: max.map((x) => Math.round(x * scale)) };
}

export function timeToX(t, dur, width) {
  return dur > 0 ? Math.min(Math.max(t / dur, 0), 1) * width : 0;
}

export function xToTime(x, width, dur) {
  return width > 0 ? Math.min(Math.max(x / width, 0), 1) * dur : 0;
}

export function sizeCanvas(canvas, width, height, dpr = 1) {
  const ratio = dpr > 0 ? dpr : 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  return ratio;
}

export function drawPeaks(ctx, peaks, o) {
  const { width, height, dpr = 1, region = null, playhead = null, duration = peaks?.duration ?? 0, colors } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const mid = height / 2;
  const x0 = region ? timeToX(region.start, duration, width) : 0;
  const x1 = region ? timeToX(region.end, duration, width) : 0;
  if (region && x1 > x0) {
    ctx.fillStyle = colors.region;
    ctx.fillRect(x0, 0, x1 - x0, height);
  }
  if (!peaks) {
    ctx.fillStyle = colors.wave;
    ctx.fillRect(0, mid - 1, width, 2);
  } else {
    const cols = Math.max(1, Math.floor(width));
    for (let x = 0; x < cols; x++) {
      const from = Math.floor((x * peaks.buckets) / cols);
      const to = Math.max(from + 1, Math.floor(((x + 1) * peaks.buckets) / cols));
      let lo = 0;
      let hi = 0;
      for (let i = from; i < to && i < peaks.buckets; i++) {
        if (peaks.min[i] < lo) lo = peaks.min[i];
        if (peaks.max[i] > hi) hi = peaks.max[i];
      }
      const top = mid - (hi / 127) * (mid - 2);
      const bottom = mid - (lo / 127) * (mid - 2);
      const inside = region && x + 0.5 >= x0 && x + 0.5 <= x1;
      ctx.fillStyle = inside ? colors.waveActive : colors.wave;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }
  if (playhead != null && duration > 0) {
    ctx.fillStyle = colors.playhead;
    ctx.fillRect(Math.min(width - 2, Math.max(0, timeToX(playhead, duration, width) - 1)), 0, 2, height);
  }
}

const cache = new Map();
const CACHE_MAX = 6;

function remember(id, value) {
  cache.delete(id);
  cache.set(id, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export function forgetPeaks() { cache.clear(); }

export async function fetchServerPeaks(id, signal) {
  const res = await fetchWhenReady(`/songs/${q(id)}/peaks`, { signal });
  if (!res.ok) throw Object.assign(new Error(`peaks ${res.status}`), { status: res.status });
  const body = await res.json();
  if (!validPeaks(body)) throw new Error('bad peaks');
  return body;
}

export async function decodeInBrowser(id, signal, win = window) {
  const Ctx = win.OfflineAudioContext || win.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no audio decoder');
  const res = await fetchWhenReady(`/files/${q(id)}`, { signal });
  if (!res.ok) throw new Error(`file ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > CLIENT_DECODE_MAX) { res.body?.cancel?.(); throw new Error('file too large to decode here'); }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > CLIENT_DECODE_MAX) throw new Error('file too large to decode here');
  const buffer = await new Ctx(1, 1, 44100).decodeAudioData(bytes);
  const peaks = reducePeaks(buffer.getChannelData(0), buffer.sampleRate);
  if (!validPeaks(peaks)) throw new Error('empty audio');
  return peaks;
}

export async function loadPeaks(id, { signal, server = fetchServerPeaks, decode = decodeInBrowser } = {}) {
  if (cache.has(id)) return cache.get(id);
  let result;
  try {
    result = { peaks: await server(id, signal), source: 'server' };
  } catch (err) {
    if (signal?.aborted) throw err;
    result = { peaks: await decode(id, signal), source: 'browser' };
  }
  remember(id, result);
  return result;
}
