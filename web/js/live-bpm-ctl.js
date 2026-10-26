import { createLiveBpm } from './live-bpm.js';
import { storeGet, storeSet } from './storage.js';

export const LIVE_BPM_KEY = 'ap.liveBpm';
const SAMPLE_MS = 40;
export const PUBLISH_MS = 500;
export const SILENT_RMS = 0.002;
export const SILENT_HOLD_S = 1.5;
const SMOOTH_COUNT = 3;

function rmsOf(samples) {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export function createLiveBpmController({ audio, player, getAnalyser, getContext, ensureGraph = () => {}, timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) }, read = () => storeGet(LIVE_BPM_KEY), write = (v) => storeSet(LIVE_BPM_KEY, v) }) {
  const det = createLiveBpm();
  const listeners = new Set();
  let on = read() === '1';
  let value = null;
  let songId = null;
  let sampleTimer = null;
  let publishTimer = null;
  let buffer = null;
  let lastTime = null;
  let recent = [];
  let quietS = 0;
  let silent = false;

  const emit = () => { for (const fn of listeners) fn(); };

  const publish = () => {
    if (!getAnalyser()) ensureGraph();
    const exact = det.estimateExact();
    if (exact !== null) recent.push(exact);
    else recent.shift();
    if (recent.length > SMOOTH_COUNT) recent.shift();
    const next = recent.length ? Math.round(median(recent) * 10) / 10 : null;
    if (next !== value) { value = next; emit(); }
  };

  const sample = () => {
    const analyser = getAnalyser();
    const ctx = getContext();
    if (!analyser || !ctx) { lastTime = null; return; }
    const rate = ctx.sampleRate;
    const size = analyser.fftSize;
    if (!buffer || buffer.length !== size) buffer = new Float32Array(size);
    analyser.getFloatTimeDomainData(buffer);
    const t = ctx.currentTime;
    const before = lastTime;
    lastTime = t;
    if (before === null) return;
    const fresh = Math.round((t - before) * rate);
    if (fresh <= 0) return;
    if (fresh > size) { det.reset(); recent = []; return; }
    const block = buffer.subarray(size - fresh);
    quietS = rmsOf(block) < SILENT_RMS ? quietS + fresh / rate : 0;
    const quiet = quietS >= SILENT_HOLD_S;
    if (quiet !== silent) {
      silent = quiet;
      if (quiet) { det.reset(); recent = []; value = null; }
      emit();
    }
    if (!quiet) det.pushSamples(block, rate);
  };

  const clearValue = () => {
    det.reset();
    recent = [];
    lastTime = null;
    quietS = 0;
    const wasSilent = silent;
    silent = false;
    if (wasSilent) emit();
    if (value !== null) { value = null; emit(); }
  };

  const stop = () => {
    if (sampleTimer !== null) timers.clearInterval(sampleTimer);
    if (publishTimer !== null) timers.clearInterval(publishTimer);
    sampleTimer = null;
    publishTimer = null;
  };

  const start = () => {
    if (sampleTimer !== null) return;
    det.setHint(player.current?.bpm);
    lastTime = null;
    sampleTimer = timers.setInterval(sample, SAMPLE_MS);
    publishTimer = timers.setInterval(publish, PUBLISH_MS);
  };

  const sync = () => {
    const id = player.current?.id ?? null;
    if (id !== songId) { songId = id; clearValue(); stop(); }
    if (on && player.playing && id) {
      ensureGraph();
      start();
    } else { stop(); if (!on) clearValue(); }
  };

  const unsubscribe = player.onChange(sync);
  const onSeeked = () => { clearValue(); };
  const onPlay = () => { clearValue(); sync(); emit(); };
  const onPause = () => { sync(); emit(); };
  audio.addEventListener('seeked', onSeeked);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  songId = player.current?.id ?? null;
  sync();

  return {
    get on() { return on; },
    get value() { return on ? value : null; },
    get silent() { return silent; },
    get songId() { return songId; },
    setOn(next) {
      on = Boolean(next);
      write(on ? '1' : '0');
      sync();
      emit();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { stop(); unsubscribe(); audio.removeEventListener('seeked', onSeeked); audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause); listeners.clear(); },
  };
}
