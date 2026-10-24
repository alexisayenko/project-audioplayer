import { createLiveBpm } from './live-bpm.js';
import { storeGet, storeSet } from './storage.js';

export const LIVE_BPM_KEY = 'ap.liveBpm';
const SAMPLE_MS = 40;
const PUBLISH_MS = 1000;
const SMOOTH_COUNT = 3;

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

  const emit = () => { for (const fn of listeners) fn(); };

  const publish = () => {
    if (!getAnalyser()) ensureGraph();
    const exact = det.estimateExact();
    if (exact !== null) recent.push(exact);
    else recent.shift();
    if (recent.length > SMOOTH_COUNT) recent.shift();
    const next = recent.length ? Math.round(median(recent)) : null;
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
    det.pushSamples(buffer.subarray(size - fresh), rate);
  };

  const clearValue = () => {
    det.reset();
    recent = [];
    lastTime = null;
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
  const onPlay = () => { clearValue(); sync(); };
  audio.addEventListener('seeked', onSeeked);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', sync);
  songId = player.current?.id ?? null;
  sync();

  return {
    get on() { return on; },
    get value() { return on ? value : null; },
    get songId() { return songId; },
    setOn(next) {
      on = Boolean(next);
      write(on ? '1' : '0');
      sync();
      emit();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { stop(); unsubscribe(); audio.removeEventListener('seeked', onSeeked); audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', sync); listeners.clear(); },
  };
}
