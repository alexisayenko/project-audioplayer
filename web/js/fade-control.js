import * as realGraph from './audio-graph.js';
import { gainAt, schedule, startsSong } from './fade.js';

const TICK_MS = 100;
const OWN_EPS = 1e-4;

export function createFader({ audio, settings, loop = null, graph = realGraph, doc = globalThis.document, volumeOk = () => true }) {
  let inActive = true;
  let timer = null;
  let base = audio.volume;
  let written = null;
  let scaled = false;

  const on = () => settings.fadeIn() > 0 || settings.fadeOut() > 0;
  const visible = () => doc?.visibilityState !== 'hidden';
  const params = () => ({
    time: audio.currentTime,
    duration: audio.duration,
    fadeIn: settings.fadeIn(),
    fadeOut: settings.fadeOut(),
    inActive,
    enabled: !loop?.get().active,
    rate: audio.playbackRate || 1,
  });
  const node = () => (graph.hasGraph() && graph.getContext()?.state === 'running' ? graph.getFade?.() ?? null : null);

  function stopTimer() {
    if (timer != null) { clearTimeout(timer); timer = null; }
  }

  function release() {
    stopTimer();
    if (!scaled) return;
    scaled = false;
    written = base;
    audio.volume = base;
  }

  function setNode(n, level, points) {
    try {
      const ctx = graph.getContext();
      const now = ctx.currentTime;
      n.gain.cancelScheduledValues(now);
      n.gain.setValueAtTime(level, now);
      for (const p of points) n.gain.linearRampToValueAtTime(p.gain, now + p.dt);
    } catch { /* node gone: fall back on next apply */ }
  }

  function setElement(g) {
    const v = base * g;
    if (g >= 1) {
      if (scaled) { scaled = false; written = base; audio.volume = base; }
      return;
    }
    if (Math.abs(audio.volume - v) < 0.002) return;
    scaled = true;
    written = v;
    audio.volume = v;
  }

  function tick() {
    timer = null;
    if (!on() || audio.paused || !visible() || node()) return;
    setElement(gainAt(params()));
    timer = setTimeout(() => tick(), TICK_MS);
  }

  function apply() {
    stopTimer();
    if (!on()) {
      const n = node();
      if (n) setNode(n, 1, []);
      release();
      return;
    }
    const p = params();
    const n = node();
    if (n) {
      release();
      const s = schedule(p);
      setNode(n, s.level, audio.paused ? [] : s.points);
      return;
    }
    if (!volumeOk() || !visible()) { release(); return; }
    if (audio.paused) setElement(gainAt(p)); else tick();
  }

  function ensureGraph() {
    if (!on() || graph.hasGraph() || !graph.isSupported?.()) return;
    graph.unlock(audio);
  }

  function reset() {
    stopTimer();
    inActive = true;
    const n = node();
    if (n) setNode(n, 1, []);
    release();
  }

  for (const ev of ['playing', 'ratechange', 'durationchange', 'loadedmetadata', 'pause']) audio.addEventListener(ev, apply);
  audio.addEventListener('play', () => { ensureGraph(); apply(); });
  audio.addEventListener('seeked', () => { inActive = startsSong(audio.currentTime); apply(); });
  audio.addEventListener('volumechange', () => {
    if (written != null && Math.abs(audio.volume - written) < OWN_EPS) return;
    base = audio.volume;
    if (scaled && audio.volume >= 1) scaled = false;
  });
  doc?.addEventListener?.('visibilitychange', apply);
  graph.onState?.(apply);
  loop?.onChange(apply);
  settings.onChange(() => { ensureGraph(); apply(); });

  return {
    apply,
    reset,
    release,
    userVolume: () => (scaled ? base : audio.volume),
  };
}
