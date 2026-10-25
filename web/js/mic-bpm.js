import { createLiveBpm, WINDOWS_S, HISTORY_S } from './live-bpm.js';

export const MAX_RUN_MS = 10 * 60 * 1000;
export const PUBLISH_MS = 500;
const SMOOTH_COUNT = 3;
export const METER_MS = 100;
export const SILENT_RMS = 0.002;
export const SILENT_HOLD_S = 1.5;
const METER_FLOOR_DB = -60;
const METER_CEIL_DB = -6;

export function rmsOf(samples) {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

export function levelFraction(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB)));
}

export function createMicBpm({ create = createLiveBpm, windows = false } = {}) {
  const det = windows ? create({ historyS: HISTORY_S }) : create();
  let quietS = 0;
  let silent = true;
  let recent = [];
  let levelDb = -Infinity;
  let exact = null;

  return {
    get silent() { return silent; },
    get exact() { return exact; },
    push(samples, sampleRate) {
      if (!samples.length || !(sampleRate > 0)) return;
      const rms = rmsOf(samples);
      levelDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      quietS = rms < SILENT_RMS ? quietS + samples.length / sampleRate : 0;
      const quiet = quietS >= SILENT_HOLD_S;
      if (quiet && !silent) { det.reset(); recent = []; }
      silent = quiet;
      if (!quiet) det.pushSamples(samples, sampleRate);
    },
    value() {
      exact = null;
      if (silent) return null;
      const bpm = det.estimateExact();
      if (Number.isFinite(bpm) && bpm > 0) recent.push(bpm);
      else recent.shift();
      if (recent.length > SMOOTH_COUNT) recent.shift();
      if (!recent.length) return null;
      exact = recent.slice().sort((a, b) => a - b)[recent.length >> 1];
      return Math.round(exact);
    },
    windows(seconds = WINDOWS_S) {
      return silent ? seconds.map(() => null) : det.estimateWindows?.(seconds) ?? seconds.map(() => null);
    },
    details() {
      const d = silent ? null : det.details?.();
      return { levelDb, silent, windowS: d?.windowS ?? 0, candidates: d?.candidates ?? [] };
    },
    reset() {
      levelDb = -Infinity;
      exact = null;
      det.reset();
      recent = [];
      quietS = 0;
      silent = true;
    },
  };
}
