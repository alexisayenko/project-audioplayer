import { FFT_SIZE, ANALYSER_SMOOTHING, ATTACK, RELEASE, TILT_DB_PER_OCT } from './viz-constants.js';
import { barsDb, unitBars, makeReference, smoothBars } from './viz-spectrum.js';
import { resample, HISTORY_BINS, ROWS_PER_SECOND } from './viz-terrain-math.js';
import { SILENT_DB } from './viz-signal.js';

export const LOOKAHEAD_MAX_S = 480;
export const LOOKAHEAD_MAX_BYTES = 64 * 1024 * 1024;
const TIME_SNAP_S = 0.35;

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
  return { total, done: 0, bins, rps, data: new Uint8Array(total * bins) };
}

export function makeTimelineBuilder({
  pcm, sampleRate, bands, bins = HISTORY_BINS, rps = ROWS_PER_SECOND, fftSize = FFT_SIZE, smoothing = ANALYSER_SMOOTHING,
}) {
  const total = timelineRows(pcm.length / sampleRate, rps);
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
  let done = 0;
  return {
    total,
    bins,
    rps,
    get done() { return done; },
    get data() { return out; },
    step(maxRows) {
      const end = Math.min(total, done + maxRows);
      const from = done;
      for (; done < end; done += 1) {
        const last = Math.round(done * dt * sampleRate);
        const first = last - fftSize;
        for (let i = 0; i < fftSize; i += 1) {
          const idx = first + i;
          re[i] = idx >= 0 && idx < pcm.length ? pcm[idx] * win[i] : 0;
          im[i] = 0;
        }
        fft(re, im);
        let peak = -Infinity;
        for (let k = 0; k < half; k += 1) {
          const m = Math.hypot(re[k], im[k]) / fftSize;
          mag[k] = smoothing * mag[k] + (1 - smoothing) * m;
          db[k] = mag[k] > 0 ? 20 * Math.log10(mag[k]) : -Infinity;
          if (db[k] > peak) peak = db[k];
        }
        let target;
        if (!(peak > SILENT_DB)) target = new Float32Array(bands);
        else {
          const levels = barsDb(db, bands, { sampleRate, fftSize, tilt: TILT_DB_PER_OCT });
          target = unitBars(levels, { ...ref.update(levels, dt) });
        }
        smoothBars(state, target, ATTACK, RELEASE, dt * 60);
        const row = resample(state, bins);
        for (let j = 0; j < bins; j += 1) out[done * bins + j] = Math.round(row[j] * 255);
      }
      return { from, to: done };
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
      else t += (a - t) * 0.15;
      return t;
    },
    reset() { last = null; },
  };
}

export function createInlineRunner({ schedule = (fn) => setTimeout(fn, 0), now = () => Date.now(), sliceMs = 8 } = {}) {
  return {
    start(job, cb) {
      const b = makeTimelineBuilder(job);
      let dead = false;
      const tick = () => {
        if (dead) return;
        const t0 = now();
        try {
          while (b.done < b.total && now() - t0 < sliceMs) {
            const r = b.step(4);
            cb.onRows(r.from, b.data.subarray(r.from * b.bins, r.to * b.bins));
          }
        } catch (err) { cb.onError(err); return; }
        if (b.done >= b.total) cb.onDone(); else schedule(tick);
      };
      schedule(tick);
      return { cancel() { dead = true; } };
    },
  };
}

export function createWorkerRunner(make) {
  return {
    start(job, cb) {
      let worker;
      try { worker = make(); } catch (err) { cb.onError(err); return { cancel() {} }; }
      let dead = false;
      worker.onmessage = (e) => {
        if (dead) return;
        const m = e.data;
        if (m.type === 'rows') cb.onRows(m.from, new Uint8Array(m.data));
        else if (m.type === 'done') cb.onDone();
        else if (m.type === 'error') cb.onError(new Error(m.message));
      };
      worker.onerror = (e) => { if (!dead) cb.onError(new Error(e?.message || 'worker failed')); };
      worker.postMessage({ type: 'build', ...job, pcm: job.pcm }, [job.pcm.buffer]);
      return { cancel() { dead = true; worker.terminate?.(); } };
    },
  };
}
