import { el } from './dom.js';
import { segmented } from './segmented.js';
import { parseColor, mixColor } from './viz-color.js';

export const MAX_RUN_MS = 10 * 60 * 1000;
export const AUDIBLE_MAX_HZ = 20000;
export const ANALYSER_DB_OFFSET = 13.56;
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;
export const DB_MIN = -90;
export const DB_MAX = 0;
export const GRAM_SECONDS = 10;
export const GRAM_DB_MIN = -90;
export const GRAM_DB_MAX = -10;
export const LIVE_RANGES = [2000, 5000, 10000];
export const DEFAULT_LIVE_MAX = 5000;
export const WAVE_MS = 40;
export const WAVE_MIN_MS = 2;
export const WAVE_MAX_MS = 150;
export const WAVE_WINDOWS = [0, 1, 2, 4];
export const WAVE_WINDOW_LABELS = { 0: '40 ms', 1: '1 cycle', 2: '2 cycles', 4: '4 cycles' };
export const WAVE_SCALES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1];
export const PEAK_MIN_HZ = 30;
export const PEAK_FLOOR_DB = -70;
export const PEAK_EVERY_MS = 200;
export const METER_WINDOW_S = 0.1;
export const METER_EVERY_MS = 100;
export const METER_FALL_DB_S = 40;
export const RMS_SINE_DB = 10 * Math.log10(2);
export const DBFS_NOTE = 'dBFS is the digital level: 0 is the loudest the device can record; it is not dB SPL (room loudness), which needs a calibrated microphone.';
export const LIVE_VIEW_NAMES = {
  wave: 'Oscilloscope view: time across, amplitude up.',
  spectrum: 'Spectrum analyzer (FFT): frequency across, level up.',
  gram: 'Spectrogram (sonogram): time across, frequency up, colour = level.',
  bands: 'Band-energy / onset view: which frequency range carries the beat.',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function noteInfo(freq) {
  if (!(freq > 0)) return { name: '-', cents: 0, text: '-' };
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { name, cents, text: `${name} ${cents >= 0 ? '+' : '-'}${Math.abs(cents)} cents` };
}

export function fmtHz(f) {
  if (!Number.isFinite(f)) return '-';
  if (f >= 10000) return `${(f / 1000).toFixed(2).replace(/\.?0+$/, '')} kHz`;
  const r = Math.round(f * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} Hz`;
}

export function logPos(f, lo = SPECTRUM_MIN_HZ, hi = SPECTRUM_MAX_HZ) {
  return clamp(Math.log(f / lo) / Math.log(hi / lo), 0, 1);
}

export const AXES = ['linear', 'log'];
export const AXIS_LABELS = { linear: 'Linear', log: 'Log' };
const TICK_STEPS = [1, 2, 2.5, 5, 10];

export function freqPos(f, axis, max) {
  return axis === 'log' ? logPos(f) : clamp(f / max, 0, 1);
}

export function fmtTick(f) {
  return f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`;
}

export function linearTicks(max, target) {
  const raw = max / clamp(Math.round(target), 1, 20);
  const e = 10 ** Math.floor(Math.log10(raw));
  const step = TICK_STEPS.map((m) => m * e).find((s) => s >= raw * 0.8);
  const out = [];
  for (let k = 0; k * step <= max * (1 + 1e-9); k += 1) out.push(+(k * step).toFixed(6));
  return out;
}

export function pickLabels(items, minGap, lo = -Infinity, hi = Infinity) {
  const shown = [];
  let edge = lo;
  for (const it of items) {
    if (it.x - it.w / 2 < edge + minGap || it.x + it.w / 2 > hi) continue;
    shown.push(it);
    edge = it.x + it.w / 2;
  }
  return shown;
}

export function gramRows(rowCount, sampleRate, bins, axis = 'log', max = SPECTRUM_MAX_HZ) {
  const bw = sampleRate / (2 * bins);
  const rows = [];
  const edge = (t) => (axis === 'log' ? SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** t : max * t);
  for (let r = 0; r < rowCount; r += 1) {
    const lo = edge(1 - (r + 1) / rowCount);
    const hi = edge(1 - r / rowCount);
    const a = clamp(Math.floor(lo / bw), 0, bins - 1);
    const b = clamp(Math.max(a, Math.ceil(hi / bw)), 0, bins - 1);
    rows.push([a, b]);
  }
  return rows;
}

export function liveAxisRange(axis, max = DEFAULT_LIVE_MAX) {
  return axis === 'log'
    ? { axis, min: SPECTRUM_MIN_HZ, max: SPECTRUM_MAX_HZ, live: true }
    : { axis, min: 0, max: LIVE_RANGES.includes(max) ? max : DEFAULT_LIVE_MAX, live: true };
}

export function axisText(r) {
  return r.axis === 'log' ? 'log frequency axis from 20 Hz to 20 kHz' : `linear frequency axis from 0 Hz to ${fmtHz(r.max)}`;
}

export function axisCaption(r) {
  if (r.axis === 'log') return 'log, 20 Hz to 20 kHz';
  return `linear, 0 Hz to ${fmtHz(r.max)}${r.live ? '' : ', harmonics evenly spaced'}`;
}

export function niceScale(peak, current = 1) {
  const target = WAVE_SCALES.find((s) => s >= peak * 1.05) ?? WAVE_SCALES.at(-1);
  if (target >= current) return target;
  return peak * 1.05 < current * 0.4 ? target : current;
}

export function scopeWindowMs(cycles, freq) {
  if (!(cycles > 0) || !(freq > 0)) return WAVE_MS;
  return clamp((cycles * 1000) / freq, WAVE_MIN_MS, WAVE_MAX_MS);
}

export function liveScope(samples, sampleRate, points, ms = WAVE_MS) {
  const win = (sampleRate * ms) / 1000;
  const len = samples.length;
  if (!(win > 2) || points < 2 || len < win * 2 + 4) return null;
  const last = len - Math.ceil(win) - 2;
  const first = Math.max(1, last - Math.floor(win));
  let peak = 0;
  for (let i = first; i < len; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  const hyst = peak * 0.1;
  let armed = false;
  let pos = first;
  let triggered = false;
  for (let i = first; i <= last; i += 1) {
    const x = samples[i];
    if (x < -hyst) armed = true;
    else if (armed && x >= 0) {
      pos = i - 1 + (-samples[i - 1]) / (x - samples[i - 1]);
      triggered = true;
      break;
    }
  }
  const out = new Float32Array(points);
  let top = 0;
  for (let k = 0; k < points; k += 1) {
    const p = pos + (k / (points - 1)) * win;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const v = samples[i0] * (1 - frac) + samples[i0 + 1] * frac;
    out[k] = v;
    top = Math.max(top, Math.abs(v));
  }
  return { out, peak: top, triggered };
}

export function peakOf(freqData, sampleRate) {
  const bins = freqData.length;
  if (bins < 4 || !(sampleRate > 0)) return null;
  const bw = sampleRate / (2 * bins);
  const lo = Math.max(1, Math.ceil(PEAK_MIN_HZ / bw));
  const hi = Math.min(bins - 2, Math.floor(AUDIBLE_MAX_HZ / bw));
  let k = -1;
  let top = -Infinity;
  for (let b = lo; b <= hi; b += 1) if (freqData[b] > top) { top = freqData[b]; k = b; }
  if (k < 0 || top + ANALYSER_DB_OFFSET < PEAK_FLOOR_DB) return null;
  const a = freqData[k - 1];
  const c = freqData[k + 1];
  const den = a - 2 * top + c;
  const delta = Number.isFinite(a) && Number.isFinite(c) && den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
  return { freq: (k + delta) * bw, db: top + ANALYSER_DB_OFFSET };
}

export function peakText(peak) {
  return peak ? `Peak: ${fmtHz(peak.freq)} (${noteInfo(peak.freq).text})` : 'Peak: -';
}

export function curveLevels(freqData, sampleRate, range, count) {
  const bins = freqData.length;
  const bw = sampleRate / (2 * bins);
  const out = new Float32Array(count);
  const edge = (t) => (range.axis === 'log' ? SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** t : range.max * t);
  for (let i = 0; i < count; i += 1) {
    const lo = edge(i / count);
    const hi = edge((i + 1) / count);
    let db;
    if (hi - lo < bw) {
      const pos = clamp((lo + hi) / (2 * bw), 0, bins - 1);
      const k = Math.min(bins - 2, Math.floor(pos));
      const p = freqData[k];
      const q = freqData[k + 1];
      db = Number.isFinite(p) && Number.isFinite(q) ? p * (1 - (pos - k)) + q * (pos - k) : Math.max(p, q);
    } else {
      const a = clamp(Math.floor(lo / bw), 0, bins - 1);
      const b = clamp(Math.ceil(hi / bw), a, bins - 1);
      db = -Infinity;
      for (let k = a; k <= b; k += 1) if (freqData[k] > db) db = freqData[k];
    }
    out[i] = db + ANALYSER_DB_OFFSET;
  }
  return out;
}

export function levelColor(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixColor(stops[i], stops[i + 1], x - i);
}

export function toDbfs(linear) {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

export function levelOf(samples, count = samples.length) {
  if (!samples.length) return { rms: DB_MIN, peak: DB_MIN };
  const n = clamp(Math.floor(count), 1, samples.length);
  let sum = 0;
  let top = 0;
  for (let i = samples.length - n; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > top) top = a;
  }
  return {
    rms: clamp(toDbfs(Math.sqrt(sum / n)) + RMS_SINE_DB, DB_MIN, DB_MAX),
    peak: clamp(toDbfs(top), DB_MIN, DB_MAX),
  };
}

export function fmtDbfs(db) {
  if (!(db > DB_MIN)) return `< ${DB_MIN} dBFS`;
  const r = Math.round(db * 10) / 10;
  return `${(r === 0 ? 0 : r).toFixed(1)} dBFS`;
}

export function meterFraction(db) {
  return (clamp(db, DB_MIN, DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN);
}

export function smoothDown(prev, next, dt, rate = METER_FALL_DB_S) {
  return next >= prev ? next : Math.max(next, prev - rate * dt);
}

export const BANDS = [
  { key: 'sub', name: 'Sub', lo: 20, hi: 60 },
  { key: 'bass', name: 'Bass', lo: 60, hi: 250 },
  { key: 'mids', name: 'Mids', lo: 250, hi: 2000 },
  { key: 'highs', name: 'Highs', lo: 2000, hi: 10000 },
];
export const BEAT_SECONDS = 10;
export const ONSET_AVG_S = 0.3;
export const ONSET_MEAN_S = 2;
export const ONSET_MULT = 1.5;
export const ONSET_MIN_DB = 2;
export const ONSET_GAP_S = 0.12;
export const ONSET_FLOOR_DB = -70;
export const LANE_MIN_SPAN_DB = 6;
export const BEAT_NOTE = `${LIVE_VIEW_NAMES.bands} Each lane is one frequency range over the last 10 s. Regular ticks show which range carries the beat (usually Sub and Bass: the kick).`;

export function bandRangeText(band) {
  const k = (f) => +(f / 1000).toFixed(2);
  return band.lo >= 1000 && band.hi >= 1000 ? `${k(band.lo)}-${k(band.hi)} kHz` : `${band.lo}-${band.hi} Hz`;
}

export function bandBins(sampleRate, bins, bands = BANDS) {
  const bw = sampleRate / (2 * bins);
  return bands.map((b) => {
    const a = clamp(Math.ceil(b.lo / bw), 1, bins - 1);
    return [a, clamp(Math.max(a, Math.floor(b.hi / bw)), a, bins - 1)];
  });
}

export function bandLevels(freqData, map) {
  return map.map(([a, z]) => {
    let sum = 0;
    for (let k = a; k <= z; k += 1) {
      const d = freqData[k];
      if (d > -Infinity) sum += 10 ** ((d + ANALYSER_DB_OFFSET) / 10);
    }
    return sum > 0 ? clamp(10 * Math.log10(sum / (z - a + 1)), DB_MIN, DB_MAX) : DB_MIN;
  });
}

export function laneRange(levels, normalize) {
  if (!normalize || !levels.length) return { lo: DB_MIN, hi: DB_MAX };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of levels) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi: Math.max(hi, lo + LANE_MIN_SPAN_DB) };
}

export function createBeatTracker(count = BANDS.length) {
  const blank = () => ({ points: [], recent: [], mean: 0, last: -Infinity, above: false, level: DB_MIN, t: -1 });
  const lanes = Array.from({ length: count }, blank);
  return {
    lanes,
    reset() { lanes.forEach((_, i) => { lanes[i] = blank(); }); },
    push(t, levels) {
      return levels.map((db, i) => {
        const lane = lanes[i];
        while (lane.recent.length && t - lane.recent[0].t > ONSET_AVG_S) lane.recent.shift();
        let avg = db;
        if (lane.recent.length) avg = lane.recent.reduce((s, r) => s + r.db, 0) / lane.recent.length;
        const strength = Math.max(0, db - avg);
        const threshold = Math.max(ONSET_MIN_DB, ONSET_MULT * lane.mean);
        const above = strength > threshold && db > ONSET_FLOOR_DB;
        const onset = above && !lane.above && t - lane.last >= ONSET_GAP_S;
        const dt = lane.t >= 0 ? t - lane.t : 0;
        lane.mean += (1 - Math.exp(-dt / ONSET_MEAN_S)) * (strength - lane.mean);
        lane.above = above;
        if (onset) lane.last = t;
        lane.t = t;
        lane.level = db;
        lane.recent.push({ t, db });
        lane.points.push({ t, db, onset });
        while (lane.points.length && t - lane.points[0].t > BEAT_SECONDS) lane.points.shift();
        return onset;
      });
    },
  };
}

export function readColors(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  const get = (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
  const rgb = (name, fallback) => parseColor(get(name, fallback), parseColor(fallback));
  return {
    ink: rgb('--ink', '#1b2024'),
    muted: rgb('--ink-muted', '#5f6669'),
    line: rgb('--line', '#ddd5c6'),
    sunken: rgb('--surface-sunken', '#e9e3d6'),
    fill: rgb('--fill', '#2298b1'),
    stops: [
      rgb('--surface-sunken', '#e9e3d6'), rgb('--chart-6', '#3558c4'), rgb('--chart-3', '#7a4fc2'),
      rgb('--chart-5', '#d2601a'), rgb('--chart-4', '#a87400'),
    ],
    font: get('--font-sans', 'system-ui, sans-serif'),
  };
}

export const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

export function fit(canvas) {
  const box = canvas.parentElement;
  const w = Math.max(1, Math.round(box?.clientWidth || canvas.clientWidth || 320));
  const h = Math.max(1, Math.round(box?.clientHeight || canvas.clientHeight || 160));
  const dpr = globalThis.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  const resized = canvas.width !== pw || canvas.height !== ph;
  if (resized) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr, resized };
}

const FREQ_TICKS = [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']];

export function specTicks(range, plotW) {
  if (range.axis === 'log') return FREQ_TICKS;
  return linearTicks(range.max, Math.floor(plotW / 80)).map((f) => [f, fmtTick(f)]);
}

export function gramTicks(rows, range, h, minGap = 18) {
  if (range.live && range.axis === 'linear') {
    return linearTicks(range.max, Math.floor(h / 30)).filter((f) => f > 0 && f < range.max).map((f) => [f, fmtTick(f)]);
  }
  if (range.axis === 'log') return FREQ_TICKS;
  const played = rows.filter((r) => r.played);
  if (!played.length) return [];
  const stride = Math.max(1, Math.ceil(minGap / (h * (played[0].freq / range.max))));
  return played.filter((_, i) => i % stride === 0).map((r) => [r.freq, `H${r.n}${r.muted ? ' (muted)' : ''} · ${fmtHz(r.freq)}`]);
}

export function drawLiveWaveView(g, colors, scope, scale, ms = WAVE_MS) {
  const { ctx, w, h } = g;
  const left = 36;
  const bottom = 18;
  const pad = 8;
  const plotW = Math.max(1, w - left - pad);
  const mid = (h - bottom) / 2;
  const amp = mid - pad;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = css(colors.muted);
  ctx.strokeStyle = css(colors.line);
  ctx.lineWidth = 1;
  for (const v of [scale, 0, -scale]) {
    const y = mid - (v / scale) * amp;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    ctx.fillText(v === 0 ? '0' : `${v > 0 ? '+' : '-'}${scale}`, left - 4, y);
  }
  ctx.textBaseline = 'top';
  const step = ms / 4;
  for (let k = 0; k <= 4; k += 1) {
    const x = left + (k / 4) * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    ctx.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
    ctx.fillText(`${+(k * step).toFixed(1)} ms`, x, h - bottom + 3);
  }
  if (!scope) return;
  ctx.strokeStyle = css(colors.fill);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = scope.length;
  for (let i = 0; i < n; i += 1) {
    const x = left + (i / (n - 1)) * plotW;
    const y = mid - clamp(scope[i] / scale, -1.2, 1.2) * amp;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawSpecGrid(g, colors, range) {
  const { ctx, w, h } = g;
  const left = 34;
  const right = 8;
  const top = 30;
  const bottom = 18;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);
  const yOf = (db) => top + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * plotH;
  const xOf = (f) => left + freqPos(f, range.axis, range.max) * plotW;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(colors.line);
  ctx.fillStyle = css(colors.muted);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const db of [0, -30, -60, -90]) {
    const y = yOf(db);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillText(String(db), left - 4, y);
  }
  ctx.textBaseline = 'top';
  for (const [f, text] of specTicks(range, plotW)) {
    const x = xOf(f);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotH); ctx.stroke();
    ctx.textAlign = 'center';
    const half = ctx.measureText(text).width / 2;
    ctx.fillText(text, Math.min(x, w - 2 - half), top + plotH + 3);
  }
  return { left, plotW, plotH, yOf, xOf };
}

export function drawLiveSpectrumView(g, colors, freqData, sampleRate, range, peak) {
  const { ctx } = g;
  const geo = drawSpecGrid(g, colors, range);
  if (!freqData) return;
  const count = Math.max(2, Math.round(geo.plotW));
  const levels = curveLevels(freqData, sampleRate, range, count);
  const base = geo.yOf(DB_MIN);
  ctx.beginPath();
  ctx.moveTo(geo.left, base);
  for (let i = 0; i < count; i += 1) ctx.lineTo(geo.left + ((i + 0.5) / count) * geo.plotW, geo.yOf(levels[i]));
  ctx.lineTo(geo.left + geo.plotW, base);
  ctx.closePath();
  ctx.fillStyle = css(colors.fill, 0.28);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const x = geo.left + ((i + 0.5) / count) * geo.plotW;
    if (i === 0) ctx.moveTo(x, geo.yOf(levels[i])); else ctx.lineTo(x, geo.yOf(levels[i]));
  }
  ctx.strokeStyle = css(colors.fill);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (peak && peak.freq <= range.max) {
    const x = geo.xOf(peak.freq);
    ctx.fillStyle = css(colors.ink);
    ctx.beginPath(); ctx.arc(x, geo.yOf(peak.db), 3, 0, 2 * Math.PI); ctx.fill();
  }
}

export function drawGramAxes(g, colors, range, ticks) {
  const { ctx, w, h } = g;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (const [f, text] of ticks) {
    const y = h * (1 - freqPos(f, range.axis, range.max));
    ctx.strokeStyle = css(colors.ink, 0.25);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const tw = ctx.measureText(text).width;
    const x = y + 7 > h - 17 ? 38 : 4;
    ctx.fillStyle = css(colors.sunken, 0.8);
    ctx.fillRect(x - 2, y - 7, tw + 4, 14);
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(text, x, y);
  }
  ctx.textBaseline = 'bottom';
  for (const [text, x, align] of [['-10 s', 4, 'left'], ['now', w - 4, 'right']]) {
    ctx.textAlign = align;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = css(colors.sunken, 0.8);
    ctx.fillRect(align === 'left' ? x - 2 : x - tw - 2, h - 16, tw + 4, 14);
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(text, x, h - 3);
  }
}

export function drawBandsView(g, colors, lanes, nowT, normalize) {
  const { ctx, w, h } = g;
  const left = 74;
  const right = 22;
  const bottom = 16;
  const plotW = Math.max(1, w - left - right);
  const laneH = (h - bottom) / BANDS.length;
  const pad = 4;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  BANDS.forEach((band, i) => {
    const lane = lanes[i];
    const y0 = i * laneH;
    const top = y0 + pad;
    const ph = laneH - 2 * pad;
    ctx.strokeStyle = css(colors.line);
    ctx.beginPath(); ctx.moveTo(0, y0 + laneH - 0.5); ctx.lineTo(w, y0 + laneH - 0.5); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 11px ${colors.font}`;
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(band.name, 6, y0 + laneH / 2 - 1);
    ctx.font = `10px ${colors.font}`;
    ctx.fillStyle = css(colors.muted);
    ctx.fillText(bandRangeText(band), 6, y0 + laneH / 2 + 11);
    const xOf = (t) => left + plotW - ((nowT - t) / BEAT_SECONDS) * plotW;
    const pts = lane.points.filter((p) => nowT - p.t <= BEAT_SECONDS);
    const { lo, hi } = laneRange(pts.map((p) => p.db), normalize);
    const yOf = (db) => top + (1 - clamp((db - lo) / (hi - lo), 0, 1)) * ph;
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(xOf(pts[0].t), top + ph);
      for (const p of pts) ctx.lineTo(xOf(p.t), yOf(p.db));
      ctx.lineTo(xOf(pts.at(-1).t), top + ph);
      ctx.closePath();
      ctx.fillStyle = css(colors.fill, 0.3);
      ctx.fill();
      ctx.beginPath();
      pts.forEach((p, k) => { if (k === 0) ctx.moveTo(xOf(p.t), yOf(p.db)); else ctx.lineTo(xOf(p.t), yOf(p.db)); });
      ctx.strokeStyle = css(colors.fill);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = css(colors.stops[3]);
    ctx.lineWidth = 2;
    for (const p of pts) {
      if (!p.onset) continue;
      const x = Math.round(xOf(p.t));
      ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y0 + laneH - 2); ctx.stroke();
    }
    const barX = w - right + 8;
    const barH = ph * ((lane.level - DB_MIN) / (DB_MAX - DB_MIN));
    ctx.fillStyle = css(colors.line);
    ctx.fillRect(barX, top, 8, ph);
    ctx.fillStyle = css(colors.fill);
    ctx.fillRect(barX, top + ph - barH, 8, barH);
  });
  ctx.lineWidth = 1;
  ctx.font = `10px ${colors.font}`;
  ctx.fillStyle = css(colors.muted);
  ctx.textBaseline = 'top';
  for (const [text, x, align] of [['-10 s', left, 'left'], ['now', left + plotW, 'right']]) {
    ctx.textAlign = align;
    ctx.fillText(text, x, h - bottom + 3);
  }
}

export const view = (canvas, cls, ...extra) => el('div', { class: `hm-view ${cls}` }, canvas, ...extra);

export function createFeeder(pick) {
  const b = { time: null, freq: null };
  return () => {
    const s = pick();
    const an = s?.an;
    const sr = s?.sr;
    if (!an || !(sr > 0)) return null;
    if (!b.time || b.time.length !== an.fftSize || b.freq.length !== an.frequencyBinCount) {
      b.time = new Float32Array(an.fftSize);
      b.freq = new Float32Array(an.frequencyBinCount);
    }
    return { an, sr, b };
  };
}

export function createColors(getNode, now) {
  let colors = null;
  let at = 0;
  return () => {
    const t = now();
    if (!colors || t - at > 500) { colors = readColors(getNode()); at = t; }
    return colors;
  };
}

export function createAxisControl({ uid, getAxis, setAxis, getMax, setMax }) {
  const axisSeg = segmented(AXES.map((a) => [a, AXIS_LABELS[a]]), getAxis, setAxis, { 'aria-labelledby': `${uid}-al` });
  const rangeSeg = getMax ? segmented(LIVE_RANGES.map((m) => [m, fmtTick(m)]), getMax, setMax, { 'aria-label': 'Linear frequency range' }) : null;
  const node = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-al`, class: 'hm-lbl' }, 'Frequency axis'),
    axisSeg.group, ...(rangeSeg ? [rangeSeg.group] : []));
  return {
    node,
    paint() {
      axisSeg.paint();
      if (!rangeSeg) return;
      rangeSeg.paint();
      rangeSeg.group.hidden = getAxis() !== 'linear';
    },
  };
}

export function createLevelMeter({ now, feed }) {
  let rmsShown = DB_MIN;
  let peakShown = DB_MIN;
  let hold = DB_MIN;
  let lastAt = 0;
  let textAt = -Infinity;
  const read = el('output', { class: 'lv-read' }, fmtDbfs(DB_MIN));
  const track = (label, ...extra) => {
    const fill = el('div', { class: 'lv-fill' });
    const bar = el('div', { class: 'lv-track', role: 'meter', 'aria-label': label, 'aria-valuemin': String(DB_MIN), 'aria-valuemax': String(DB_MAX), 'aria-valuenow': String(DB_MIN) }, fill, ...extra);
    return { fill, bar, row: el('div', { class: 'lv-row' }, el('span', { class: 'lv-name t-caption muted' }, label), bar) };
  };
  const mark = el('span', { class: 'lv-mark', hidden: true });
  const rmsBar = track('RMS');
  const peakBar = track('Peak', mark);
  const holdBtn = el('button', { class: 'btn outline lv-hold', type: 'button', title: 'Click to reset the peak hold', onclick: () => resetHold() }, 'Peak hold: -');
  const scale = el('div', { class: 'lv-scale t-caption muted', 'aria-hidden': 'true' },
    ...[DB_MIN, -60, -30, DB_MAX].map((v) => el('span', {}, String(v))));
  const node = el('div', { class: 'hm-block lv' },
    el('h3', { class: 't-subhead' }, 'Level'),
    el('div', { class: 'lv-top' }, read, holdBtn),
    rmsBar.row, peakBar.row, scale,
    el('p', { class: 'hm-cap muted t-caption' }, DBFS_NOTE));

  function paint(t) {
    rmsBar.fill.style.transform = `scaleX(${meterFraction(rmsShown).toFixed(4)})`;
    peakBar.fill.style.transform = `scaleX(${meterFraction(peakShown).toFixed(4)})`;
    const has = hold > DB_MIN;
    mark.hidden = !has;
    if (has) mark.style.left = `${(meterFraction(hold) * 100).toFixed(2)}%`;
    if (t - textAt < METER_EVERY_MS) return;
    textAt = t;
    read.textContent = fmtDbfs(rmsShown);
    holdBtn.textContent = `Peak hold: ${has ? fmtDbfs(hold) : '-'}`;
    rmsBar.bar.setAttribute('aria-valuenow', String(Math.round(rmsShown)));
    rmsBar.bar.setAttribute('aria-valuetext', fmtDbfs(rmsShown));
    peakBar.bar.setAttribute('aria-valuenow', String(Math.round(peakShown)));
    peakBar.bar.setAttribute('aria-valuetext', fmtDbfs(peakShown));
  }

  function resetHold() {
    hold = DB_MIN;
    textAt = -Infinity;
    paint(now());
  }

  return {
    node,
    get hold() { return hold; },
    get rms() { return rmsShown; },
    resetHold,
    reset() {
      rmsShown = DB_MIN;
      peakShown = DB_MIN;
      hold = DB_MIN;
      lastAt = 0;
      textAt = -Infinity;
      paint(now());
    },
    update() {
      const t = now();
      const dt = lastAt ? Math.min(0.25, Math.max(0, (t - lastAt) / 1000)) : 0;
      lastAt = t;
      let lv = { rms: DB_MIN, peak: DB_MIN };
      const f = feed();
      if (f) {
        f.an.getFloatTimeDomainData(f.b.time);
        lv = levelOf(f.b.time, Math.round(f.sr * METER_WINDOW_S));
      }
      rmsShown = smoothDown(rmsShown, lv.rms, dt);
      peakShown = smoothDown(peakShown, lv.peak, dt);
      if (lv.peak > hold) hold = lv.peak;
      paint(t);
    },
  };
}

export function createLiveWave({ uid, colors, feed, what, freq }) {
  let win = 0;
  let scale = 1;
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const caption = el('p', { class: 'hm-cap muted t-caption' });
  const seg = segmented(WAVE_WINDOWS.map((c) => [c, WAVE_WINDOW_LABELS[c]]), () => win, (c) => set(c), { 'aria-labelledby': `${uid}-wl` });
  const node = el('div', { class: 'hm-block' },
    el('h3', { class: 't-subhead' }, 'Waveform'),
    el('div', { class: 'hm-axis' }, el('span', { id: `${uid}-wl`, class: 'hm-lbl' }, 'Time window'), seg.group),
    view(canvas, 'hm-wave'),
    caption);

  function describe() {
    const shown = win ? `${WAVE_WINDOW_LABELS[win]} of the loudest tone` : `${WAVE_MS} ms`;
    canvas.setAttribute('aria-label', `Waveform of ${what()} signal, ${shown}`);
    const span = win
      ? `Window: ${WAVE_WINDOW_LABELS[win]} of the loudest tone (${WAVE_MS} ms while no tone is found).`
      : `Window ${WAVE_MS} ms.`;
    caption.textContent = `${LIVE_VIEW_NAMES.wave} ${span} Scaled to the signal. It starts at a rising zero crossing so the shape holds still.`;
  }

  function paint() {
    const g = fit(canvas);
    if (!g) return;
    const f = feed();
    const points = Math.max(32, Math.round(g.w - 44));
    let scope = null;
    let ms = WAVE_MS;
    if (f) {
      ms = scopeWindowMs(win, freq());
      f.an.getFloatTimeDomainData(f.b.time);
      const s = liveScope(f.b.time, f.sr, points, ms);
      if (s) { scale = niceScale(s.peak, scale); scope = s.out; }
    }
    drawLiveWaveView(g, colors(), scope, scale, ms);
  }

  function set(next) {
    if (next === win || !WAVE_WINDOWS.includes(next)) return;
    win = next;
    seg.paint();
    describe();
    paint();
  }

  seg.paint();
  describe();
  return {
    node,
    get window() { return win; },
    set,
    paint,
    describe,
    reset() { scale = 1; },
  };
}

export function createLiveSpectrum({ uid, colors, now, feed, range, axisControl, what }) {
  let peakAt = 0;
  let peakShown = '';
  let peak = null;
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const caption = el('p', { class: 'hm-cap muted t-caption' });
  const peakOut = el('p', { class: 'hm-peak t-subhead', role: 'status', 'aria-live': 'off' }, peakText(null));
  const node = el('div', { class: 'hm-block' },
    el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Spectrum'), axisControl.node),
    view(canvas, 'hm-spec'),
    caption,
    peakOut);

  function describe() {
    const r = range();
    canvas.setAttribute('aria-label', `Spectrum of ${what()} signal, ${axisText(r)}`);
    caption.textContent = `${LIVE_VIEW_NAMES.spectrum} Frequency axis ${axisCaption(r)}, level in dBFS. The dot marks the loudest frequency.`;
  }

  function showPeak(p) {
    const t = now();
    if (t - peakAt < PEAK_EVERY_MS && p !== null) return;
    peakAt = t;
    const text = peakText(p);
    if (text !== peakShown) { peakShown = text; peakOut.textContent = text; }
  }

  return {
    node,
    get peak() { return peak; },
    describe,
    paint() {
      const g = fit(canvas);
      if (!g) return;
      const f = feed();
      let data = null;
      peak = null;
      if (f) {
        f.an.getFloatFrequencyData(f.b.freq);
        data = f.b.freq;
        peak = peakOf(data, f.sr);
      }
      showPeak(peak);
      drawLiveSpectrumView(g, colors(), data, f?.sr ?? 0, range(), peak);
    },
    reset() {
      peak = null;
      peakShown = '';
      showPeak(null);
    },
  };
}

export function createGramView({ colors, feed, range, ticks }) {
  let pending = 0;
  let rowsKey = '';
  let map = [];
  let axisKey = '';
  let painted = null;
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const axes = el('canvas', { class: 'hm-canvas hm-axes', 'aria-hidden': 'true' });
  const scaleBar = el('span', { class: 'hm-scale', 'aria-hidden': 'true' });
  const caption = el('p', { class: 'hm-cap muted t-caption' });
  const node = el('div', { class: 'hm-block' },
    el('h3', { class: 't-subhead' }, 'Spectrogram'),
    view(canvas, 'hm-gram', axes),
    el('div', { class: 'hm-legend t-caption muted' }, el('span', {}, `${GRAM_DB_MIN} dB`), scaleBar, el('span', {}, `${GRAM_DB_MAX} dB`)),
    caption);
  const keyNow = () => { const r = range(); return `${r.axis}|${r.max}`; };

  function palette() {
    const c = colors();
    if (c !== painted) {
      painted = c;
      scaleBar.style.background = `linear-gradient(to right, ${c.stops.map((s) => css(s)).join(', ')})`;
    }
    return c;
  }

  function paintAxes() {
    const g = fit(axes);
    if (!g) return;
    const r = range();
    drawGramAxes(g, palette(), r, ticks(r, g.h));
  }

  function clear() {
    axisKey = keyNow();
    const g = fit(canvas);
    if (!g) return;
    g.ctx.setTransform(1, 0, 0, 1, 0, 0);
    g.ctx.clearRect(0, 0, canvas.width, canvas.height);
    g.ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  }

  return {
    node,
    caption,
    canvas,
    paintAxes,
    clear,
    restart() { pending = 0; clear(); },
    refresh() { rowsKey = ''; clear(); paintAxes(); },
    step(dt) {
      const g = fit(canvas);
      if (!g) return;
      const f = feed();
      if (!f) return;
      const b = f.b;
      if (g.resized) paintAxes();
      if (keyNow() !== axisKey) clear();
      const { ctx } = g;
      const pw = canvas.width;
      const ph = canvas.height;
      pending += (pw * dt) / GRAM_SECONDS;
      const dx = Math.floor(pending);
      if (dx < 1) return;
      pending -= dx;
      f.an.getFloatFrequencyData(b.freq);
      const rowCount = Math.min(ph, 160);
      const r = range();
      const key = `${rowCount}|${f.sr}|${b.freq.length}|${r.axis}|${r.max}`;
      if (key !== rowsKey) { rowsKey = key; map = gramRows(rowCount, f.sr, b.freq.length, r.axis, r.max); }
      const c = palette();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (dx < pw) ctx.drawImage(canvas, -dx, 0);
      const strip = Math.min(dx, pw);
      const rowH = ph / rowCount;
      for (let i = 0; i < rowCount; i += 1) {
        const [a, z] = map[i];
        let top = -Infinity;
        for (let k = a; k <= z; k += 1) if (b.freq[k] > top) top = b.freq[k];
        const level = (top + ANALYSER_DB_OFFSET - GRAM_DB_MIN) / (GRAM_DB_MAX - GRAM_DB_MIN);
        ctx.fillStyle = css(levelColor(c.stops, level));
        ctx.fillRect(pw - strip, Math.floor(i * rowH), strip, Math.ceil(rowH) + 1);
      }
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    },
  };
}

export function createBandsView({ uid, colors, feed }) {
  let normalize = true;
  let beatKey = '';
  let beatMap = [];
  let beatAt = 0;
  const tracker = createBeatTracker();
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const normBox = el('input', { id: `${uid}-nb`, type: 'checkbox', checked: true, onchange: () => { normalize = normBox.checked; paint(); } });
  const node = el('div', { class: 'hm-block' },
    el('div', { class: 'hm-head' },
      el('h3', { class: 't-subhead' }, 'Beat bands'),
      el('span', { class: 'hm-check' }, normBox, el('label', { htmlFor: `${uid}-nb` }, 'Normalize per band'))),
    view(canvas, 'hm-bands'),
    el('p', { class: 'hm-cap muted t-caption' }, BEAT_NOTE));

  function paint() {
    const g = fit(canvas);
    if (g) drawBandsView(g, colors(), tracker.lanes, beatAt, normalize);
  }

  return {
    node,
    paint,
    describe(what) {
      canvas.setAttribute('aria-label', `Beat bands of ${what}, last 10 seconds: four lanes, ${BANDS.map((b) => `${b.name} ${bandRangeText(b)}`).join(', ')}, each with its level and the detected beats marked`);
    },
    reset() {
      tracker.reset();
      beatAt = 0;
    },
    step(t) {
      const f = feed();
      if (f) {
        f.an.getFloatFrequencyData(f.b.freq);
        const key = `${f.sr}|${f.b.freq.length}`;
        if (key !== beatKey) { beatKey = key; beatMap = bandBins(f.sr, f.b.freq.length); }
        beatAt = t / 1000;
        tracker.push(beatAt, bandLevels(f.b.freq, beatMap));
      }
      paint();
    },
  };
}
