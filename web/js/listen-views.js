import { el } from './dom.js';
import { segmented } from './segmented.js';
import { stepper } from './stepper.js';
import { parseColor, mixColor } from './viz-color.js';
import { detectPitch, correctOctave, harmonicMarks, foundList, createPitchTracker, PITCH_EVERY_MS, HARMONIC_LABEL_GAP_PX } from './pitch-detect.js';
import {
  BAND_COUNTS, DEFAULT_BAND_COUNT, BAND_TABLES, bandsFor, lowLaneCount, bandsHeight, laneHeight, bandsLabel, bandRangeText,
  LANE_BPM_W, LANE_UPDATE_MS, LANE_CAPTION, laneRelation, estimateLane, laneScratch, laneBpmText, laneConfidence, laneTitle,
} from './beat-bands.js';

export { BAND_COUNTS, DEFAULT_BAND_COUNT, BAND_TABLES, bandsFor, lowLaneCount, bandsHeight, bandRangeText };

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
export const TRAIL_FADE_DB = 40;
export const TRAIL_LENGTH_S = 10;
export const TRAIL_LENGTH_MIN_S = 0.5;
export const TRAIL_LENGTH_MAX_S = 60;
export const TRAIL_LENGTH_STEP_S = 0.5;
export const TRAIL_DECAY_DB_S = TRAIL_FADE_DB / TRAIL_LENGTH_S;
export const trailRate = (seconds) => TRAIL_FADE_DB / seconds;
export const trailLengthText = (seconds) => `${+seconds.toFixed(1)} s`;
export const TRAIL_FLOOR_DB = -200;
export const TRAILS_HINT = 'The spectrum keeps a fading ghost of recent peaks, like a phosphor screen.';
export const RMS_SINE_DB =10 * Math.log10(2);
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

export function freqAt(pos, axis, max) {
  const p = clamp(pos, 0, 1);
  return axis === 'log' ? SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** p : max * p;
}

export const H1_HINT_ROW_PX = 12;
export const SPEC_PAD = { left: 34, right: 8, top: 30 + H1_HINT_ROW_PX, bottom: 18 };

export function specGeo(w, h) {
  const { left, right, top, bottom } = SPEC_PAD;
  return { left, top, plotW: Math.max(1, w - left - right), plotH: Math.max(1, h - top - bottom) };
}

export const specX = (f, range, geo) => geo.left + freqPos(f, range.axis, range.max) * geo.plotW;
export const specFreq = (x, range, geo) => freqAt((x - geo.left) / geo.plotW, range.axis, range.max);

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
  const edge = (t) => freqAt(t, axis, max);
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

export function curveLevels(freqData, sampleRate, range, count, out = new Float32Array(count)) {
  const bins = freqData.length;
  const bw = sampleRate / (2 * bins);
  const edge = (t) => freqAt(t, range.axis, range.max);
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

export function trailLevel(peak, peakAt, now, rate = TRAIL_DECAY_DB_S, floor = TRAIL_FLOOR_DB) {
  const fell = peak - rate * (Math.max(0, now - peakAt) / 1000);
  return fell > floor ? fell : floor;
}

export function holdTrail(shown, peaks, peakTimes, current, now, rate = TRAIL_DECAY_DB_S, floor = TRAIL_FLOOR_DB) {
  for (let i = 0; i < shown.length; i += 1) {
    const ghost = trailLevel(peaks[i], peakTimes[i], now, rate, floor);
    const level = current[i];
    if (level >= ghost) {
      peaks[i] = level;
      peakTimes[i] = now;
      shown[i] = level > floor ? level : floor;
    } else {
      shown[i] = ghost;
    }
  }
  return shown;
}

let trailSeconds = TRAIL_LENGTH_S;

export function createTrails() {
  let on = true;
  let buf = null;
  let keys = null;
  let scratch = null;
  let peaks = null;
  let peakTimes = null;
  let at = null;
  const clear = () => { buf?.fill(TRAIL_FLOOR_DB); peaks?.fill(TRAIL_FLOOR_DB); at = null; };
  return {
    get on() { return on; },
    get buf() { return on ? buf : null; },
    get length() { return trailSeconds; },
    setLength(next) {
      const n = Number(next);
      if (!Number.isFinite(n)) return;
      trailSeconds = clamp(n, TRAIL_LENGTH_MIN_S, TRAIL_LENGTH_MAX_S);
      if (!buf || at === null) return;
      const rate = trailRate(trailSeconds);
      for (let i = 0; i < buf.length; i += 1) buf[i] = trailLevel(peaks[i], peakTimes[i], at, rate);
    },
    set(next) { on = Boolean(next); clear(); },
    clear,
    step(current, t, items = null) {
      if (!on) return null;
      if (!buf || buf.length !== current.length) {
        buf = new Float32Array(current.length).fill(TRAIL_FLOOR_DB);
        peaks = new Float32Array(current.length).fill(TRAIL_FLOOR_DB);
        peakTimes = new Float64Array(current.length);
        keys = null;
        at = null;
      }
      if (items) {
        if (!keys || keys.length !== items.length) { keys = new Float64Array(items.length).fill(NaN); }
        let same = true;
        for (let i = 0; i < items.length; i += 1) if (keys[i] !== items[i].freq) { same = false; keys[i] = items[i].freq; }
        if (!same) clear();
      }
      at = t;
      return holdTrail(buf, peaks, peakTimes, current, t, trailRate(trailSeconds));
    },
    levels(count) {
      if (!scratch || scratch.length !== count) scratch = new Float32Array(count);
      return scratch;
    },
  };
}

export function createTrailControl({ uid, trails, onChange }) {
  const id = `${uid}-trails`;
  const box = el('input', { id, type: 'checkbox', checked: trails.on, onchange: () => { trails.set(box.checked); lengthField.hidden = !trails.on; onChange(); } });
  const check = el('span', { class: 'hm-check', title: TRAILS_HINT }, box, el('label', { htmlFor: id }, 'Trails'));
  const lengthId = `${uid}-trail-len`;
  const length = stepper({
    id: lengthId, label: 'Trail length', min: TRAIL_LENGTH_MIN_S, max: TRAIL_LENGTH_MAX_S, step: TRAIL_LENGTH_STEP_S,
    get: () => trails.length, set: (v) => { trails.setLength(v); length.sync(); onChange(); },
    unit: 's', inputmode: 'decimal', decLabel: 'Shorter trail', incLabel: 'Longer trail',
  });
  const lengthField = el('span', { class: 'hm-trail-len', hidden: !trails.on }, el('label', { htmlFor: lengthId }, 'Trail length'), length.group);
  const node = el('span', { class: 'hm-trail-ctl' }, check, lengthField);
  return {
    node,
    paint() { box.checked = trails.on; lengthField.hidden = !trails.on; length.sync(); },
  };
}

export function createMarkControl({ uid, get, set }) {
  const id = `${uid}-marks`;
  const box = el('input', { id, type: 'checkbox', checked: get(), onchange: () => set(box.checked) });
  const node = el('span', { class: 'hm-check', title: MARKS_HINT }, box, el('label', { htmlFor: id }, 'Mark harmonics'));
  return { node, paint() { box.checked = get(); } };
}

export const BANDS = BAND_TABLES[4];
export const BEAT_SECONDS = 10;
export const ONSET_AVG_S = 0.3;
export const ONSET_MEAN_S = 2;
export const ONSET_MULT = 1.5;
export const ONSET_MIN_DB = 2;
export const ONSET_GAP_S = 0.12;
export const ONSET_FLOOR_DB = -70;
export const LANE_MIN_SPAN_DB = 6;
export const BEAT_NOTE = `${LIVE_VIEW_NAMES.bands} Each lane is one frequency range over the last 10 s. Regular ticks show which range carries the beat (usually Sub and Bass: the kick).`;
export const GRID_NOTE = 'Faint vertical lines are the detected beat. If the ticks line up with them the BPM matches the music.';
export const GRID_MIN_PX = 14;
export const GRID_ANCHOR_S = 2;
export const GRID_STRONG = 0.6;
export const GRID_LANES = 2;
export const GRID_ALPHA = 0.3;
export const BANDS_LEFT = 74;
export const BANDS_LEFT_WIDE = 176;
export const BANDS_WIDE_MIN = 520;
export const BANDS_RIGHT = 22;
export const BANDS_BOTTOM = 16;
export const LANE_TEXT_MIN_PX = 26;

export const bandsLeft = (w) => (w >= BANDS_WIDE_MIN ? BANDS_LEFT_WIDE : BANDS_LEFT);
export const bandsPlotW = (w, extraRight = 0) => Math.max(1, w - bandsLeft(w) - BANDS_RIGHT - extraRight);

export function gridEvery(period, plotW) {
  if (!(period > 0) || !(plotW > 0)) return 1;
  return Math.max(1, Math.ceil(GRID_MIN_PX / ((period / BEAT_SECONDS) * plotW)));
}

export const gridEveryText = (every) => (every > 1 ? `Fast tempo: grid every ${every} beats.` : '');

export function gridAnchor(lanes, nowT, lowLanes = GRID_LANES) {
  const found = [];
  let top = 0;
  for (let i = 0; i < Math.min(lowLanes, lanes.length); i += 1) {
    const pts = lanes[i].points;
    for (let k = pts.length - 1; k >= 0 && nowT - pts[k].t <= GRID_ANCHOR_S; k -= 1) {
      if (!pts[k].onset) continue;
      found.push(pts[k]);
      if (pts[k].strength > top) top = pts[k].strength;
    }
  }
  let latest = null;
  for (const p of found) if (p.strength >= GRID_STRONG * top && (latest === null || p.t > latest.t)) latest = p;
  if (!latest) return null;
  let first = latest.t;
  for (const p of found) if (p.strength >= GRID_STRONG * top && latest.t - p.t < ONSET_GAP_S && p.t < first) first = p.t;
  return first;
}

export function tempoGrid(lanes, bpm, nowT, plotW, lowLanes = GRID_LANES) {
  if (!(bpm > 0)) return null;
  const anchor = gridAnchor(lanes, nowT, lowLanes);
  if (anchor === null) return null;
  const period = 60 / bpm;
  const every = gridEvery(period, plotW);
  const step = period * every;
  const times = [];
  for (let t = anchor; t >= nowT - BEAT_SECONDS; t -= step) times.push(t);
  return { period, every, anchor, times };
}

export function bandBins(sampleRate, bins, bands = BANDS) {
  const bw = sampleRate / (2 * bins);
  return bands.map((b) => {
    const a = clamp(Math.ceil(b.lo / bw), 1, bins - 1);
    return [a, clamp(Math.max(a, Math.floor(b.hi / bw)), a, bins - 1)];
  });
}

export function bandLevels(freqData, map, out = new Array(map.length)) {
  for (let i = 0; i < map.length; i += 1) {
    const a = map[i][0];
    const z = map[i][1];
    let sum = 0;
    for (let k = a; k <= z; k += 1) {
      const d = freqData[k];
      if (d > -Infinity) sum += 10 ** ((d + ANALYSER_DB_OFFSET) / 10);
    }
    out[i] = sum > 0 ? clamp(10 * Math.log10(sum / (z - a + 1)), DB_MIN, DB_MAX) : DB_MIN;
  }
  return out;
}

const SPAN = { lo: DB_MIN, hi: DB_MAX };

export function laneSpan(points, from, normalize) {
  SPAN.lo = DB_MIN;
  SPAN.hi = DB_MAX;
  if (!normalize || from >= points.length) return SPAN;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = from; k < points.length; k += 1) {
    const v = points[k].db;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  SPAN.lo = lo;
  SPAN.hi = Math.max(hi, lo + LANE_MIN_SPAN_DB);
  return SPAN;
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
  const onsets = new Array(count);
  return {
    lanes,
    reset() { lanes.forEach((_, i) => { lanes[i] = blank(); }); },
    push(t, levels) {
      onsets.length = levels.length;
      for (let i = 0; i < levels.length; i += 1) {
        const db = levels[i];
        const lane = lanes[i];
        while (lane.recent.length && t - lane.recent[0].t > ONSET_AVG_S) lane.recent.shift();
        let avg = db;
        if (lane.recent.length) {
          let sum = 0;
          for (let r = 0; r < lane.recent.length; r += 1) sum += lane.recent[r].db;
          avg = sum / lane.recent.length;
        }
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
        lane.points.push({ t, db, onset, strength: onset ? strength : 0 });
        while (lane.points.length && t - lane.points[0].t > BEAT_SECONDS) lane.points.shift();
        onsets[i] = onset;
      }
      return onsets;
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
    surface: rgb('--surface', '#fbf8f2'),
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
  const geo = specGeo(w, h);
  const { left, top, plotW, plotH } = geo;
  const yOf = (db) => top + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * plotH;
  const xOf = (f) => specX(f, range, geo);
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(colors.line);
  ctx.fillStyle = css(colors.muted);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const db of [0, -30, -60, -90]) {
    const y = yOf(db);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
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
  return { left, top, plotW, plotH, yOf, xOf };
}

export const HOVER_SNAP_PX = 8;

export function fmtHoverHz(f) {
  if (!Number.isFinite(f)) return '-';
  return Math.round(f) < 1000 ? `${Math.round(f)} Hz` : `${(f / 1000).toFixed(2)} kHz`;
}

export function specHover(px, geo, range, { levels = null, bars = [] } = {}) {
  if (!(px >= geo.left && px <= geo.left + geo.plotW)) return null;
  let near = null;
  for (const b of bars) {
    const d = Math.abs(b.x - px);
    if (d <= HOVER_SNAP_PX && (!near || d < near.d)) near = { b, d };
  }
  let x = px;
  let freq;
  let db = -Infinity;
  let title;
  if (near) {
    x = near.b.x;
    freq = near.b.freq;
    db = near.b.db;
    title = `${near.b.name} · ${fmtHoverHz(freq)}`;
  } else {
    freq = specFreq(px, range, geo);
    title = fmtHoverHz(freq);
    if (levels?.length) db = levels[clamp(Math.floor(((px - geo.left) / geo.plotW) * levels.length), 0, levels.length - 1)];
  }
  const r = Math.round(db * 10) / 10;
  const level = db > DB_MIN ? `${(r === 0 ? 0 : r).toFixed(1)} dB` : '-';
  return { x, freq, title, sub: `${noteInfo(freq).text} · ${level}` };
}

export function drawSpecHover(g, colors, geo, hover) {
  if (!hover) return;
  const { ctx, w } = g;
  const x = Math.round(hover.x) + 0.5;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(colors.ink, 0.55);
  ctx.beginPath(); ctx.moveTo(x, geo.top); ctx.lineTo(x, geo.top + geo.plotH); ctx.stroke();
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const bw = Math.ceil(Math.max(ctx.measureText(hover.title).width, ctx.measureText(hover.sub).width)) + 10;
  const bh = 30;
  const by = geo.top + 4;
  const bx = x + 6 + bw <= w - 2 ? x + 6 : Math.max(2, x - 6 - bw);
  ctx.fillStyle = css(colors.surface, 0.94);
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = css(colors.line);
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = css(colors.ink);
  ctx.fillText(hover.title, bx + 5, by + 12);
  ctx.fillText(hover.sub, bx + 5, by + 25);
  ctx.restore();
}

export function trackHover(canvas, onChange) {
  const state = { x: null };
  const move = (e) => { state.x = e.clientX - canvas.getBoundingClientRect().left; onChange(); };
  const clear = () => { if (state.x === null) return; state.x = null; onChange(); };
  const release = (e) => { if (e.pointerType && e.pointerType !== 'mouse') clear(); };
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', clear);
  canvas.addEventListener('pointerleave', clear);
  return state;
}

export const TRAIL_FILL_ALPHA = 0.14;
export const TRAIL_LINE_ALPHA = 0.5;

export function drawSpecTrail(g, colors, geo, ghost) {
  const { ctx } = g;
  const count = ghost.length;
  const base = geo.yOf(DB_MIN);
  const xAt = (i) => geo.left + ((i + 0.5) / count) * geo.plotW;
  ctx.beginPath();
  ctx.moveTo(geo.left, base);
  for (let i = 0; i < count; i += 1) ctx.lineTo(xAt(i), geo.yOf(ghost[i]));
  ctx.lineTo(geo.left + geo.plotW, base);
  ctx.closePath();
  ctx.fillStyle = css(colors.fill, TRAIL_FILL_ALPHA);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    if (i === 0) ctx.moveTo(xAt(i), geo.yOf(ghost[i])); else ctx.lineTo(xAt(i), geo.yOf(ghost[i]));
  }
  ctx.strokeStyle = css(colors.fill, TRAIL_LINE_ALPHA);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export const MARKS_HINT = 'Marks the detected pitch and its harmonics on the spectrum: solid where a real peak sits, hollow where a harmonic is missing.';
export const NO_PITCH_TEXT = 'No single pitch (polyphonic or noisy sound)';
export const PITCH_IDLE_TEXT = 'Pitch: -';
export const PITCH_RANGE_TEXT = 'Pitch outside the visible range';
export const MARK_TICK_PX = 8;
export const H1_EXPLAIN = 'H1 is the fundamental: the pitch you hear. H2 and up are its overtones.';
export const H1_HINTS = ['H1 · fundamental: the pitch you hear', 'fundamental'];
export const CENT_HREF = '#/glossary/cent';
export const H1_HINT_GAP_PX = 6;
export const H1_HINT_LONG_MIN_W = 480;

export function h1HintText(measure, x, w, h2Left = Infinity) {
  const [long, short] = H1_HINTS;
  for (const text of [long, short]) {
    const tw = measure(text);
    const left = clamp(x - tw / 2, 2, Math.max(2, w - 2 - tw));
    if (left + tw > w - 2) continue;
    if (text === long && (w < H1_HINT_LONG_MIN_W || left + tw + H1_HINT_GAP_PX > h2Left)) continue;
    return { text, left };
  }
  return null;
}

export function visibleMarks(items, range) {
  return (items ?? []).filter((m) => m.freq >= range.min && m.freq <= range.max);
}

export function pitchText(locked, f0, items, range, loudest = 0) {
  if (!locked) return NO_PITCH_TEXT;
  if (f0 < range.min || f0 > range.max) return PITCH_RANGE_TEXT;
  const lower = loudest > f0 * 1.5 ? `; lower than the loudest peak (${fmtHz(loudest)})` : '';
  return `Pitch: ${fmtHz(f0)} (${noteInfo(f0).text}), harmonics found: ${foundList(visibleMarks(items, range))}${lower}. ${H1_EXPLAIN}`;
}

export function loudestPeakHz(peak, raw) {
  return peak && Math.abs(peak.freq / raw - 1) < 0.05 ? peak.freq : raw;
}

export function harmonicBars(marks, geo, range, levels) {
  if (!marks || !(marks.alpha > 0)) return [];
  return visibleMarks(marks.items, range).map((m) => {
    const x = geo.xOf(m.freq);
    const i = clamp(Math.floor(((x - geo.left) / geo.plotW) * levels.length), 0, levels.length - 1);
    return { x, freq: m.freq, db: levels[i], name: `H${m.n}` };
  });
}

export function drawHarmonicMarks(g, colors, geo, range, marks) {
  if (!marks || !(marks.alpha > 0)) return;
  const { ctx, w } = g;
  const top = geo.top - MARK_TICK_PX;
  ctx.save();
  ctx.globalAlpha = clamp(marks.alpha, 0, 1);
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let lastLabel = -Infinity;
  let h2Left = Infinity;
  let h1X = null;
  for (const m of visibleMarks(marks.items, range)) {
    if (m.n === 1) h1X = Math.round(geo.xOf(m.freq));
    const x = Math.round(geo.xOf(m.freq));
    if (m.found) {
      ctx.strokeStyle = css(colors.ink);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, geo.top + 2); ctx.stroke();
    } else {
      ctx.strokeStyle = css(colors.muted, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, top + 0.5, 3, MARK_TICK_PX + 1);
    }
    const text = `H${m.n}`;
    const half = ctx.measureText(text).width / 2;
    if (m.n === 2) h2Left = x - half;
    if (x - lastLabel < HARMONIC_LABEL_GAP_PX || x - half < 0 || x + half > w - 2) continue;
    lastLabel = x;
    ctx.fillStyle = m.found ? css(colors.ink) : css(colors.muted, 0.8);
    ctx.fillText(text, x, top - 3);
  }
  if (h1X !== null) {
    const hint = h1HintText((t) => ctx.measureText(t).width, h1X, w, h2Left);
    if (hint) {
      ctx.fillStyle = css(colors.muted);
      ctx.textAlign = 'left';
      ctx.fillText(hint.text, hint.left, top - 3 - H1_HINT_ROW_PX);
    }
  }
  ctx.restore();
}

export function drawLiveSpectrumView(g, colors, freqData, sampleRate, range, peak, hoverX = null, trails = null, marks = null) {
  const { ctx } = g;
  const geo = drawSpecGrid(g, colors, range);
  if (!freqData) {
    if (hoverX !== null) drawSpecHover(g, colors, geo, specHover(hoverX, geo, range));
    return;
  }
  const count = Math.max(2, Math.round(geo.plotW));
  const levels = curveLevels(freqData, sampleRate, range, count);
  const base = geo.yOf(DB_MIN);
  const trail = trails?.buf;
  if (trail) drawSpecTrail(g, colors, geo, curveLevels(trail, sampleRate, range, count, trails.levels(count)));
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
  drawHarmonicMarks(g, colors, geo, range, marks);
  if (hoverX !== null) drawSpecHover(g, colors, geo, specHover(hoverX, geo, range, { levels, bars: harmonicBars(marks, geo, range, levels) }));
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

function drawLaneLabel(ctx, colors, band, y0, laneH, left, wide) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (!wide || laneH < LANE_TEXT_MIN_PX) {
    ctx.font = `10px ${colors.font}`;
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(band.range, 6, y0 + laneH / 2 + 3.5);
    return;
  }
  ctx.font = `600 11px ${colors.font}`;
  ctx.fillStyle = css(colors.ink);
  ctx.fillText(band.name, 6, y0 + laneH / 2 - 1);
  const nameW = ctx.measureText(band.name).width;
  ctx.font = `10px ${colors.font}`;
  ctx.fillStyle = css(colors.muted);
  if (band.hint && 6 + nameW + 6 + ctx.measureText(band.hint).width <= left - 6) ctx.fillText(band.hint, 6 + nameW + 6, y0 + laneH / 2 - 1);
  ctx.fillText(band.range, 6, y0 + laneH / 2 + 11);
}

export function drawBandsView(g, colors, lanes, nowT, normalize, grid = null, bands = BANDS, extraRight = 0) {
  const { ctx, w, h } = g;
  const left = bandsLeft(w);
  const right = BANDS_RIGHT;
  const bottom = BANDS_BOTTOM;
  const plotW = bandsPlotW(w, extraRight);
  const laneH = laneHeight(h, bands.length);
  const wide = w >= BANDS_WIDE_MIN;
  const pad = 4;
  const secPx = plotW / BEAT_SECONDS;
  const base = left + plotW;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (let i = 0; i < bands.length; i += 1) {
    const lane = lanes[i];
    const y0 = i * laneH;
    const top = y0 + pad;
    const ph = laneH - 2 * pad;
    ctx.strokeStyle = css(colors.line);
    ctx.beginPath(); ctx.moveTo(0, y0 + laneH - 0.5); ctx.lineTo(w, y0 + laneH - 0.5); ctx.stroke();
    drawLaneLabel(ctx, colors, bands[i], y0, laneH, left, wide);
    const pts = lane.points;
    let from = 0;
    while (from < pts.length && nowT - pts[from].t > BEAT_SECONDS) from += 1;
    const span = laneSpan(pts, from, normalize);
    const lo = span.lo;
    const range = span.hi - span.lo;
    if (pts.length - from > 1) {
      ctx.beginPath();
      ctx.moveTo(base - (nowT - pts[from].t) * secPx, top + ph);
      for (let k = from; k < pts.length; k += 1) {
        ctx.lineTo(base - (nowT - pts[k].t) * secPx, top + (1 - clamp((pts[k].db - lo) / range, 0, 1)) * ph);
      }
      ctx.lineTo(base - (nowT - pts[pts.length - 1].t) * secPx, top + ph);
      ctx.closePath();
      ctx.fillStyle = css(colors.fill, 0.3);
      ctx.fill();
      ctx.beginPath();
      for (let k = from; k < pts.length; k += 1) {
        const x = base - (nowT - pts[k].t) * secPx;
        const y = top + (1 - clamp((pts[k].db - lo) / range, 0, 1)) * ph;
        if (k === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = css(colors.fill);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = css(colors.stops[3]);
    ctx.lineWidth = 2;
    for (let k = from; k < pts.length; k += 1) {
      if (!pts[k].onset) continue;
      const x = Math.round(base - (nowT - pts[k].t) * secPx);
      ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y0 + laneH - 2); ctx.stroke();
    }
    const barX = w - right + 8;
    const barH = ph * ((lane.level - DB_MIN) / (DB_MAX - DB_MIN));
    ctx.fillStyle = css(colors.line);
    ctx.fillRect(barX, top, 8, ph);
    ctx.fillStyle = css(colors.fill);
    ctx.fillRect(barX, top + ph - barH, 8, barH);
  }
  ctx.lineWidth = 1;
  if (grid?.times.length) {
    ctx.strokeStyle = css(colors.ink, GRID_ALPHA);
    ctx.beginPath();
    for (const t of grid.times) {
      const x = Math.round(left + plotW - ((nowT - t) / BEAT_SECONDS) * plotW) + 0.5;
      if (x < left) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - bottom);
    }
    ctx.stroke();
  }
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
  const trails = createTrails();
  const trailControl = createTrailControl({ uid, trails, onChange: () => { describe(); paint(); } });
  let marking = true;
  let pitchAt = -Infinity;
  let pitchShown = '';
  let items = [];
  const tracker = createPitchTracker();
  const markControl = createMarkControl({ uid, get: () => marking, set: (next) => setMarking(next) });
  const pitchOut = el('p', { class: 'hm-peak t-subhead', role: 'status', 'aria-live': 'off' }, PITCH_IDLE_TEXT);
  const node = el('div', { class: 'hm-block' },
    el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Spectrum'), el('div', { class: 'hm-checks' }, trailControl.node, markControl.node, axisControl.node)),
    view(canvas, 'hm-spec'),
    caption,
    peakOut,
    pitchOut);

  function describe() {
    const r = range();
    canvas.setAttribute('aria-label', `Spectrum of ${what()} signal, ${axisText(r)}`);
    const ghost = trails.on ? ` The faint ghost behind the curve is where recent peaks were; it fades out in about ${trailLengthText(trails.length)}.` : '';
    const ticks = marking ? ' The ticks above the curve mark the detected pitch and its harmonics: solid where a real peak sits, hollow where a harmonic is missing.' : '';
    caption.textContent = `${LIVE_VIEW_NAMES.spectrum} Frequency axis ${axisCaption(r)}, level in dBFS. The dot marks the loudest frequency.${ghost}${ticks}`;
  }

  function showPitch(text) {
    if (text === pitchShown) return;
    pitchShown = text;
    const m = text.match(/^(.*? )(cents)(\).*)$/s);
    if (m) pitchOut.replaceChildren(m[1], el('a', { href: CENT_HREF, target: '_blank', rel: 'noopener', title: 'What is a cent? (opens the glossary in a new tab)' }, m[2]), m[3]);
    else pitchOut.textContent = text;
  }

  function markState(f, data) {
    const t = now();
    if (!f) {
      tracker.reset();
      items = [];
      pitchAt = -Infinity;
      showPitch(PITCH_IDLE_TEXT);
      return null;
    }
    if (t - pitchAt >= PITCH_EVERY_MS) {
      pitchAt = t;
      f.an.getFloatTimeDomainData(f.b.time);
      const est = detectPitch(f.b.time, f.sr);
      const s = tracker.update(est && correctOctave(est, data, f.sr, { offsetDb: ANALYSER_DB_OFFSET, maxHz: AUDIBLE_MAX_HZ }), t);
      if (s.locked) items = harmonicMarks(data, f.sr, s.freq, { offsetDb: ANALYSER_DB_OFFSET, maxHz: AUDIBLE_MAX_HZ });
    }
    const s = tracker.state(t);
    showPitch(pitchText(s.locked, s.freq, items, range(), s.raw ? loudestPeakHz(peak, s.raw) : 0));
    return { items, alpha: s.alpha };
  }

  function setMarking(next) {
    const on = Boolean(next);
    if (on === marking) return;
    marking = on;
    tracker.reset();
    items = [];
    pitchAt = -Infinity;
    pitchShown = '';
    pitchOut.hidden = !on;
    showPitch(PITCH_IDLE_TEXT);
    markControl.paint();
    describe();
    paint();
  }

  function showPeak(p) {
    const t = now();
    if (t - peakAt < PEAK_EVERY_MS && p !== null) return;
    peakAt = t;
    const text = peakText(p);
    if (text !== peakShown) { peakShown = text; peakOut.textContent = text; }
  }

  function paint() {
    const g = fit(canvas);
    if (!g) return;
    const f = feed();
    let data = null;
    peak = null;
    if (f) {
      f.an.getFloatFrequencyData(f.b.freq);
      data = f.b.freq;
      peak = peakOf(data, f.sr);
      trails.step(data, now());
    } else {
      trails.clear();
    }
    showPeak(peak);
    const marks = marking ? markState(f, data) : null;
    drawLiveSpectrumView(g, colors(), data, f?.sr ?? 0, range(), peak, hover.x, trails, marks);
  }

  const hover = trackHover(canvas, paint);

  return {
    node,
    get peak() { return peak; },
    get trails() { return trails; },
    get marking() { return marking; },
    get pitchText() { return pitchShown; },
    setMarking,
    describe,
    paint,
    reset() {
      tracker.reset();
      items = [];
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

export function createBandsView({ uid, colors, feed, note = BEAT_NOTE, count = DEFAULT_BAND_COUNT, laneBpm = true }) {
  let normalize = true;
  let beatSr = 0;
  let beatBins = 0;
  let beatMap = [];
  let beatAt = 0;
  let bpm = 0;
  let grid = null;
  let every = 1;
  let what = 'the signal';
  let bandCount = BAND_COUNTS.includes(count) ? count : DEFAULT_BAND_COUNT;
  let bands = bandsFor(bandCount);
  let lowLanes = lowLaneCount(bands);
  let tracker = createBeatTracker(bands.length);
  let levels = new Array(bands.length);
  let main = 0;
  let laneAt = -Infinity;
  let laneRes = [];
  let cells = [];
  let scratch = null;
  const extraRight = laneBpm ? LANE_BPM_W : 0;
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const normBox = el('input', { id: `${uid}-nb`, type: 'checkbox', checked: true, onchange: () => { normalize = normBox.checked; paint(); } });
  const caption = el('p', { class: 'hm-cap muted t-caption' }, note);
  const laneCaption = laneBpm ? el('p', { class: 'hm-cap muted t-caption' }, LANE_CAPTION) : null;
  const laneList = laneBpm ? el('ol', { class: 'hm-lanes', 'aria-label': 'Repeat rate of each band' }) : null;
  const stage = laneBpm ? view(canvas, 'hm-bands', laneList) : view(canvas, 'hm-bands');
  const countSeg = segmented(BAND_COUNTS.map((n) => [n, String(n)]), () => bandCount, (n) => setCount(n), { 'aria-labelledby': `${uid}-bl` });
  const node = el('div', { class: 'hm-block' },
    el('div', { class: 'hm-head' },
      el('h3', { class: 't-subhead' }, 'Beat bands'),
      el('div', { class: 'hm-checks' },
        el('div', { class: 'hm-axis' }, el('span', { id: `${uid}-bl`, class: 'hm-lbl' }, 'Bands'), countSeg.group),
        el('span', { class: 'hm-check' }, normBox, el('label', { htmlFor: `${uid}-nb` }, 'Normalize per band')))),
    stage,
    caption,
    laneCaption);
  stage.style.setProperty('--bands-h', `${bandsHeight(bandCount)}px`);
  countSeg.paint();
  buildCells();

  function buildCells() {
    if (!laneList) return;
    laneRes = new Array(bands.length).fill(null);
    scratch = laneScratch();
    cells = bands.map(() => {
      const val = el('span', { class: 'hm-lane-val' }, '-');
      const fill = el('i');
      const bar = el('span', { class: 'rh-bar', 'aria-hidden': 'true' }, fill);
      const chip = el('span', { class: 'hm-lane-chip', hidden: true });
      return { item: el('li', { class: 'hm-lane' }, val, bar, chip), val, fill, chip, text: '', title: '', drift: false };
    });
    laneList.style.setProperty('--lanes', String(bands.length));
    laneList.replaceChildren(...cells.map((c) => c.item));
    paintCells();
  }

  function paintCells() {
    for (let i = 0; i < cells.length; i += 1) {
      const c = cells[i];
      const res = laneRes[i] ?? null;
      const rel = laneRelation(main, res?.bpm);
      const text = laneBpmText(res);
      if (text !== c.text) { c.text = text; c.val.textContent = text; }
      c.fill.style.width = `${laneConfidence(res)}%`;
      const title = laneTitle(bands[i], res, rel);
      if (title !== c.title) { c.title = title; c.item.setAttribute('title', title); c.item.setAttribute('aria-label', title); }
      const chip = res ? rel.chip : '';
      if (chip !== c.chip.textContent) { c.chip.textContent = chip; c.chip.hidden = !chip; }
      const drift = !!res && rel.kind === 'other';
      if (drift !== c.drift) { c.drift = drift; c.item.classList.toggle('is-drift', drift); }
    }
  }

  function updateLanes(t) {
    if (!laneList || t - laneAt < LANE_UPDATE_MS) return;
    laneAt = t;
    for (let i = 0; i < bands.length; i += 1) laneRes[i] = estimateLane(tracker.lanes[i].points, scratch);
    paintCells();
  }

  function setCount(next) {
    if (!BAND_COUNTS.includes(next) || next === bandCount) return;
    bandCount = next;
    bands = bandsFor(next);
    lowLanes = lowLaneCount(bands);
    tracker = createBeatTracker(bands.length);
    levels = new Array(bands.length);
    beatMap = [];
    beatSr = 0;
    beatBins = 0;
    beatAt = 0;
    grid = null;
    laneAt = -Infinity;
    buildCells();
    stage.style.setProperty('--bands-h', `${bandsHeight(next)}px`);
    countSeg.paint();
    describe(what);
    paint();
  }

  function describe(next) {
    what = next;
    canvas.setAttribute('aria-label', `Beat bands of ${what}, last 10 seconds: ${bands.length} lanes, ${bandsLabel(bands)}, each with its level and the detected beats marked`);
  }

  function showEvery(next) {
    if (next === every) return;
    every = next;
    caption.textContent = [note, gridEveryText(every)].filter(Boolean).join(' ');
  }

  function paint() {
    const g = fit(canvas);
    if (!g) return;
    grid = bpm > 0 ? tempoGrid(tracker.lanes, bpm, beatAt, bandsPlotW(g.w, extraRight), lowLanes) : null;
    if (grid) showEvery(grid.every);
    drawBandsView(g, colors(), tracker.lanes, beatAt, normalize, grid, bands, extraRight);
  }

  return {
    node,
    caption,
    get grid() { return grid; },
    get lanes() { return tracker.lanes; },
    get count() { return bandCount; },
    get bands() { return bands; },
    get lowLanes() { return lowLanes; },
    setCount,
    setTempo(next) {
      bpm = next > 0 ? Number(next) : 0;
      if (!bpm) { grid = null; showEvery(1); }
      if (laneList && bpm !== main) { main = bpm; paintCells(); }
    },
    get laneResults() { return laneRes; },
    paint,
    describe,
    reset() {
      tracker.reset();
      beatAt = 0;
      laneAt = -Infinity;
      if (laneList) { laneRes.fill(null); paintCells(); }
    },
    step(t) {
      const f = feed();
      if (f) {
        f.an.getFloatFrequencyData(f.b.freq);
        if (f.sr !== beatSr || f.b.freq.length !== beatBins) {
          beatSr = f.sr;
          beatBins = f.b.freq.length;
          beatMap = bandBins(f.sr, f.b.freq.length, bands);
        }
        beatAt = t / 1000;
        tracker.push(beatAt, bandLevels(f.b.freq, beatMap, levels));
        updateLanes(t);
      }
      paint();
    },
  };
}
