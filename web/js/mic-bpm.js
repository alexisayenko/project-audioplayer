import { createLiveBpm } from './live-bpm.js';

export const MAX_RUN_MS = 10 * 60 * 1000;
export const PUBLISH_MS = 1000;
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

export function createMicBpm({ create = createLiveBpm } = {}) {
  const det = create();
  let quietS = 0;
  let silent = true;

  return {
    get silent() { return silent; },
    push(samples, sampleRate) {
      if (!samples.length || !(sampleRate > 0)) return;
      quietS = rmsOf(samples) < SILENT_RMS ? quietS + samples.length / sampleRate : 0;
      const quiet = quietS >= SILENT_HOLD_S;
      if (quiet && !silent) det.reset();
      silent = quiet;
      if (!quiet) det.pushSamples(samples, sampleRate);
    },
    value() {
      if (silent) return null;
      const bpm = det.estimate();
      return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
    },
    reset() {
      det.reset();
      quietS = 0;
      silent = true;
    },
  };
}
