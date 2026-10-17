import { FFT_SIZE, ANALYSER_SMOOTHING, ATTACK, RELEASE, TILT_DB_PER_OCT } from './viz-constants.js';
import { barsDb, unitBars, makeReference, smoothBars } from './viz-spectrum.js';
import { resample, HISTORY_BINS, ROWS_PER_SECOND, markRows, uncoveredSpans, timelineCovers, coveredRows, coverageWeight, EDGE_FADE_ROWS } from './viz-terrain-math.js';

export { markRows, uncoveredSpans, timelineCovers, coveredRows, coverageWeight, EDGE_FADE_ROWS };
import { SILENT_DB } from './viz-signal.js';
import { createPartsBaker, PLANES } from './viz-melody.js';

export const ANALYSIS_CENTRE = 0.5;
export const LOOKAHEAD_MAX_S = 480;
export const LOOKAHEAD_MAX_BYTES = 64 * 1024 * 1024;
const TIME_SNAP_S = 0.25;
const TIME_PULL_TAU_S = 0.0935;

export function makeFft(n) {
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) throw new Error('fft size must be a power of two');
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let r = 0;
    for (let b = 0; b < levels; b += 1) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i += 1) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, w = 0; k < half; k += 1, w += step) {
          const a = start + k;
          const b = a + half;
          const tr = re[b] * cos[w] - im[b] * sin[w];
          const ti = re[b] * sin[w] + im[b] * cos[w];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

export function blackman(n) {
  const w = new Float64Array(n);
  const alpha = 0.16;
  for (let i = 0; i < n; i += 1) {
    const x = i / n;
    w[i] = (1 - alpha) / 2 - 0.5 * Math.cos(2 * Math.PI * x) + (alpha / 2) * Math.cos(4 * Math.PI * x);
  }
  return w;
}

export function timelineRows(durationS, rps = ROWS_PER_SECOND) {
  return Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS * rps) + 1 : 0;
}

export function createTimeline(durationS, bins = HISTORY_BINS, rps = ROWS_PER_SECOND) {
  const total = timelineRows(durationS, rps);
  return { total, done: 0, ranges: [], ver: 0, bins, rps, data: new Uint8Array(total * bins), parts: new Uint8Array(total * bins * PLANES), partsDone: 0, pitch: new Uint8Array(total * 2), pitchDone: 0 };
}

export const WINDOW_BACK_S = 3;
export const WINDOW_FWD_S = 15;
export const WINDOW_WARM_S = 4;
export const WINDOW_OUT_S = 10;
export const WINDOW_REACH_S = 45;
export const PREFETCH_S = 20;

export function planWindows(tl, focusRow, { sDone = 0 } = {}) {
  const rps = tl.rps;
  const f = Math.max(0, Math.min(tl.total - 1, Math.round(focusRow)));
  const lo = Math.max(0, f - Math.round(WINDOW_BACK_S * rps));
  const hi = Math.min(tl.total, f + Math.round(WINDOW_FWD_S * rps));
  const plan = [];
  const push = (a, b) => { for (const s of uncoveredSpans(tl, a, b)) plan.push(s); };
  push(lo, hi);
  const chunk = Math.round(WINDOW_OUT_S * rps);
  const reach = Math.round(WINDOW_REACH_S * rps);
  let fwd = hi;
  let back = lo;
  while (fwd < Math.min(tl.total, f + reach) || back > Math.max(0, f - Math.round(reach / 3))) {
    if (fwd < Math.min(tl.total, f + reach)) { push(fwd, Math.min(tl.total, fwd + chunk)); fwd += chunk; }
    if (back > Math.max(0, f - Math.round(reach / 3))) { const a = Math.max(0, back - chunk); push(a, back); back = a; }
  }
  return plan.filter(([a, b]) => b > a && !(a <= sDone && b <= sDone));
}

export const needsWindow = (tl, focusRow, sDone) => focusRow - Math.round(WINDOW_BACK_S * tl.rps) > sDone + Math.round(5 * tl.rps);

export function prefetchDue({ on, nextSrc, cached, status, busy }) {
  return !!on && !!nextSrc && !cached && !busy && (status === 'ready' || status === 'building');
}

export function statusText(st) {
  const { status, error, done = 0, total = 0, cached, stage } = st;
  const tag = cached ? ' (cached)' : '';
  if (status === 'idle') return 'timeline: idle';
  if (status === 'loading') return `timeline: loading ${stage || 'fetch'}`;
  if (status === 'building') return `timeline: building ${total ? Math.floor((100 * done) / total) : 0}%${tag}`;
  if (status === 'ready') return `timeline: ready${tag}`;
  if (status === 'failed') return `timeline: failed: ${error || 'unknown'}`;
  return `timeline: ${status}`;
}

export function makeTimelineBuilder({
  pcm, sampleRate, bands, bins = HISTORY_BINS, rps = ROWS_PER_SECOND, fftSize = FFT_SIZE, smoothing = ANALYSER_SMOOTHING, centre = ANALYSIS_CENTRE,
  from = 0, to = Infinity, warm = 0,
}) {
  const total = timelineRows(pcm.length / sampleRate, rps);
  const start = Math.max(0, Math.min(total, from));
  const end = Math.max(start, Math.min(total, to));
  const full = start === 0 && end === total;
  const half = fftSize / 2;
  const fft = makeFft(fftSize);
  const win = blackman(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const mag = new Float64Array(half);
  const db = new Float32Array(half);
  const ref = makeReference();
  const state = new Float32Array(bands);
  const dt = 1 / rps;
  const out = new Uint8Array(total * bins);
  const baker = full ? createPartsBaker({ total, bins, rps, sampleRate, fftSize }) : null;
  const rowF = new Float32Array(bins);
  let done = Math.max(0, start - warm);
  const loadFrame = (row) => {
    const last = Math.round(row * dt * sampleRate);
    const lead = last - Math.round(fftSize * (1 - centre));
    for (let i = 0; i < fftSize; i += 1) {
      const idx = lead + i;
      re[i] = idx >= 0 && idx < pcm.length ? pcm[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
  };
  const analyse = () => {
    let peak = -Infinity;
    for (let k = 0; k < half; k += 1) {
      const m = Math.hypot(re[k], im[k]) / fftSize;
      mag[k] = smoothing * mag[k] + (1 - smoothing) * m;
      db[k] = mag[k] > 0 ? 20 * Math.log10(mag[k]) : -Infinity;
      if (db[k] > peak) peak = db[k];
    }
    return peak;
  };
  const rowTarget = (peak) => {
    if (!(peak > SILENT_DB)) return new Float32Array(bands);
    const levels = barsDb(db, bands, { sampleRate, fftSize, tilt: TILT_DB_PER_OCT });
    return unitBars(levels, { ...ref.update(levels, dt) });
  };
  return {
    total,
    end,
    bins,
    rps,
    get done() { return done; },
    get data() { return out; },
    get parts() { return baker?.parts ?? null; },
    get partsDone() { return baker?.done ?? 0; },
    get pitch() { return baker?.pitch ?? null; },
    get pitchDone() { return baker?.pitchDone ?? 0; },
    step(maxRows) {
      const stop = Math.min(end, done + maxRows);
      const first = done;
      const pFrom = baker ? baker.done : 0;
      const kFrom = baker ? baker.pitchDone : 0;
      for (; done < stop; done += 1) {
        loadFrame(done);
        const target = rowTarget(analyse());
        smoothBars(state, target, ATTACK, RELEASE, dt * 60);
        const row = resample(state, bins);
        for (let j = 0; j < bins; j += 1) {
          out[done * bins + j] = Math.round(row[j] * 255);
          rowF[j] = out[done * bins + j] / 255;
        }
        if (baker) baker.add(rowF, mag);
      }
      if (baker && done >= total) baker.finish();
      return { from: Math.max(first, start), to: Math.max(done, start), pFrom, pTo: baker ? baker.done : 0, kFrom, kTo: baker ? baker.pitchDone : 0 };
    },
  };
}

export function makeBuildScheduler(job, { windows = true } = {}) {
  const main = makeTimelineBuilder(job);
  const built = { total: main.total, rps: main.rps, ranges: [] };
  let win = null;
  let queue = [];
  let focusRow = Math.max(0, Math.round(job.focus || 0));
  let dirty = windows;
  const cover = () => {
    const c = { total: built.total, rps: built.rps, ranges: built.ranges.slice() };
    markRows(c, 0, main.done);
    return c;
  };
  const replan = () => {
    dirty = false;
    const c = cover();
    queue = needsWindow(c, focusRow, main.done) ? planWindows(c, focusRow, { sDone: main.done }) : [];
    win = null;
  };
  const openWindow = () => {
    while (!win && queue.length) {
      const [a, b] = queue.shift();
      const left = uncoveredSpans(cover(), a, b);
      if (left.length) { win = makeTimelineBuilder({ ...job, from: left[0][0], to: left[0][1], warm: Math.round(WINDOW_WARM_S * main.rps) }); break; }
    }
  };
  const stepWindow = (maxRows, sink) => {
    const r = win.step(maxRows);
    if (r.to > r.from) { sink.rows(r.from, win.data.subarray(r.from * win.bins, r.to * win.bins), true); markRows(built, r.from, r.to); }
    if (win.done >= win.end) win = null;
  };
  const stepMain = (maxRows, sink) => {
    const r = main.step(maxRows);
    if (r.to > r.from) sink.rows(r.from, main.data.subarray(r.from * main.bins, r.to * main.bins), false);
    if (r.pTo > r.pFrom) sink.parts?.(r.pFrom, main.parts.subarray(r.pFrom * main.bins * PLANES, r.pTo * main.bins * PLANES));
    if (r.kTo > r.kFrom) sink.pitch?.(r.kFrom, main.pitch.subarray(r.kFrom * 2, r.kTo * 2));
  };
  return {
    get busy() { return main.done < main.end || !!win || !!queue.length || dirty; },
    focus(row) { if (windows && Number.isFinite(row)) { focusRow = Math.max(0, Math.round(row)); dirty = true; } },
    step(maxRows, sink) {
      if (dirty) replan();
      openWindow();
      if (win) stepWindow(maxRows, sink);
      else if (main.done < main.end) stepMain(maxRows, sink);
      return this.busy;
    },
  };
}

export function downmixMono(buffer) {
  const n = buffer.length;
  const ch = buffer.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c += 1) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i += 1) out[i] += d[i];
  }
  if (ch > 1) for (let i = 0; i < n; i += 1) out[i] /= ch;
  return out;
}

export function makeTimeFollower() {
  let t = 0;
  let last = null;
  return {
    update(audioTime, nowMs, playing, rate = 1) {
      const a = Number.isFinite(audioTime) ? audioTime : 0;
      if (last === null || !playing) { t = a; last = nowMs; return t; }
      const dt = Math.max(0, Math.min(0.25, (nowMs - last) / 1000));
      last = nowMs;
      t += dt * (Number.isFinite(rate) && rate > 0 ? rate : 1);
      if (Math.abs(t - a) > TIME_SNAP_S) t = a;
      else t += (a - t) * (1 - Math.exp(-dt / TIME_PULL_TAU_S));
      return t;
    },
    reset() { last = null; },
  };
}

export function createInlineRunner({ schedule = (fn) => setTimeout(fn, 0), now = () => Date.now(), sliceMs = 8 } = {}) {
  return {
    start(job, cb) {
      const sch = makeBuildScheduler(job);
      const sink = {
        rows: (from, rows, win) => cb.onRows(from, rows, win),
        parts: (from, rows) => cb.onParts?.(from, rows),
        pitch: (from, rows) => cb.onPitch?.(from, rows),
      };
      let dead = false;
      const tick = () => {
        if (dead) return;
        const t0 = now();
        let more = true;
        try {
          while (more && now() - t0 < sliceMs) more = sch.step(4, sink);
        } catch (err) { cb.onError(err); return; }
        if (!more) cb.onDone(); else schedule(tick);
      };
      schedule(tick);
      return { cancel() { dead = true; }, focus(row) { sch.focus(row); } };
    },
  };
}

export function createWorkerRunner(make) {
  return {
    start(job, cb) {
      let worker;
      try { worker = make(); } catch (err) { cb.onError(err); return { cancel() {}, focus() {} }; }
      let dead = false;
      worker.onmessage = (e) => {
        if (dead) return;
        const m = e.data;
        if (m.type === 'rows') cb.onRows(m.from, new Uint8Array(m.data), !!m.win);
        else if (m.type === 'parts') cb.onParts?.(m.from, new Uint8Array(m.data));
        else if (m.type === 'pitch') cb.onPitch?.(m.from, new Uint8Array(m.data));
        else if (m.type === 'done') cb.onDone();
        else if (m.type === 'error') cb.onError(new Error(m.message));
      };
      worker.onerror = (e) => { if (!dead) cb.onError(new Error(e?.message || 'worker failed')); };
      worker.onmessageerror = () => { if (!dead) cb.onError(new Error('worker message failed')); };
      worker.postMessage({ type: 'build', ...job, pcm: job.pcm }, [job.pcm.buffer]);
      return { cancel() { dead = true; worker.terminate?.(); }, focus(row) { if (!dead) worker.postMessage({ type: 'focus', row }); } };
    },
  };
}
