import { createLiveBpm } from './live-bpm.js';
import { storeGet, storeSet } from './storage.js';

export const LIVE_BPM_KEY = 'ap.liveBpm';
const SAMPLE_MS = 25;
const PUBLISH_MS = 1000;
const LOW_HZ = [40, 160];

export function lowBandEnergy(bytes, sampleRate, binCount) {
  const hzPerBin = sampleRate / 2 / binCount;
  const from = Math.max(1, Math.floor(LOW_HZ[0] / hzPerBin));
  const to = Math.min(binCount - 1, Math.ceil(LOW_HZ[1] / hzPerBin));
  let sum = 0;
  for (let i = from; i <= to; i += 1) sum += bytes[i];
  return sum / ((to - from + 1) * 255);
}

export function createLiveBpmController({ audio, player, getAnalyser, getSampleRate, now = () => performance.now() / 1000, timers = { setInterval, clearInterval }, read = () => storeGet(LIVE_BPM_KEY), write = (v) => storeSet(LIVE_BPM_KEY, v) }) {
  const det = createLiveBpm();
  const listeners = new Set();
  let on = read() === '1';
  let value = null;
  let songId = null;
  let sampleTimer = null;
  let publishTimer = null;
  let bytes = null;

  const emit = () => { for (const fn of listeners) fn(); };

  const publish = () => {
    const next = det.estimate();
    if (next !== value) { value = next; emit(); }
  };

  const sample = () => {
    const analyser = getAnalyser();
    if (!analyser) return;
    if (!bytes || bytes.length !== analyser.frequencyBinCount) bytes = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bytes);
    det.push(now(), lowBandEnergy(bytes, getSampleRate() || 44100, analyser.frequencyBinCount));
  };

  const clearValue = () => {
    det.reset();
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
    sampleTimer = timers.setInterval(sample, SAMPLE_MS);
    publishTimer = timers.setInterval(publish, PUBLISH_MS);
  };

  const sync = () => {
    const id = player.current?.id ?? null;
    if (id !== songId) { songId = id; clearValue(); stop(); }
    if (on && player.playing && id) start();
    else { stop(); if (!on) clearValue(); }
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
