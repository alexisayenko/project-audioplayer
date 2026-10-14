import { createTimeline, downmixMono, makeTimeFollower, createWorkerRunner, createInlineRunner, LOOKAHEAD_MAX_S, LOOKAHEAD_MAX_BYTES } from './viz-timeline.js';
import { LOOK_S, HISTORY_BINS, ROWS_PER_SECOND } from './viz-terrain-math.js';

export const LOOK_MARGIN_S = 1.2;
const srcOf = (audio) => audio?.currentSrc || audio?.src || '';

function defaultRunner(win) {
  if (typeof win.Worker !== 'function') return createInlineRunner();
  const url = new URL('./viz-timeline-worker.js', import.meta.url);
  return createWorkerRunner(() => new win.Worker(url, { type: 'module' }));
}

export function createLookahead({
  audio, win = globalThis, fetchFn = (...a) => win.fetch(...a), getSampleRate = () => 44100, getBands = () => 300,
  makeRunner = () => defaultRunner(win), makeCtx = (sr) => new (win.OfflineAudioContext || win.webkitOfflineAudioContext)(1, 1, sr),
  maxSeconds = LOOKAHEAD_MAX_S, maxBytes = LOOKAHEAD_MAX_BYTES,
} = {}) {
  const keys = new Set();
  const listeners = new Set();
  const follower = makeTimeFollower();
  let src = '';
  let status = 'idle';
  let timeline = null;
  let job = null;
  let gen = 0;
  const emit = () => { for (const fn of listeners) fn(status); };

  function cancel() {
    gen += 1;
    job?.abort?.abort();
    job?.run?.cancel();
    job = null;
    timeline = null;
    src = '';
    status = 'idle';
    follower.reset();
  }

  async function load(url, mine) {
    const abort = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    job = { abort, run: null };
    const fail = () => { if (mine === gen) { status = 'failed'; job = null; emit(); } };
    try {
      const duration = audio.duration;
      if (!(duration > 0) || duration > maxSeconds || !Number.isFinite(duration)) { fail(); return; }
      const res = await fetchFn(url, { credentials: 'same-origin', signal: abort?.signal });
      if (mine !== gen) return;
      if (!res.ok) { fail(); return; }
      const len = Number(res.headers?.get?.('content-length'));
      if (len > maxBytes) { fail(); return; }
      const bytes = await res.arrayBuffer();
      if (mine !== gen) return;
      if (bytes.byteLength > maxBytes) { fail(); return; }
      const sampleRate = getSampleRate();
      const decoded = await makeCtx(sampleRate).decodeAudioData(bytes);
      if (mine !== gen) return;
      const pcm = downmixMono(decoded);
      const tl = createTimeline(pcm.length / decoded.sampleRate, HISTORY_BINS, ROWS_PER_SECOND);
      if (!tl.total) { fail(); return; }
      timeline = tl;
      status = 'building';
      job.run = makeRunner().start(
        { pcm, sampleRate: decoded.sampleRate, bands: getBands(), bins: tl.bins, rps: tl.rps },
        {
          onRows(from, rows) {
            if (mine !== gen) return;
            tl.data.set(rows, from * tl.bins);
            tl.done = Math.min(tl.total, from + rows.length / tl.bins);
          },
          onParts(from, rows) {
            if (mine !== gen) return;
            tl.parts.set(rows, from * tl.bins * 3);
            tl.partsDone = Math.min(tl.total, from + rows.length / (tl.bins * 3));
          },
          onPitch(from, rows) {
            if (mine !== gen) return;
            tl.pitch.set(rows, from * 2);
            tl.pitchDone = Math.min(tl.total, from + rows.length / 2);
          },
          onDone() { if (mine === gen) { tl.done = tl.total; status = 'ready'; job = null; emit(); } },
          onError() { if (mine === gen) { timeline = null; fail(); } },
        },
      );
      emit();
    } catch {
      fail();
    }
  }

  function sync() {
    if (!keys.size || !audio) { if (status !== 'idle') { cancel(); emit(); } return; }
    const cur = srcOf(audio);
    if (cur === src) return;
    if (status !== 'idle') cancel();
    if (!cur) return;
    src = cur;
    status = 'loading';
    void load(cur, gen);
  }

  const onAudio = () => { if (keys.size) { sync(); emit(); } };
  for (const t of ['loadstart', 'emptied', 'seeked']) audio?.addEventListener?.(t, onAudio);

  return {
    get status() { return status; },
    get timeline() { return timeline; },
    request(key, on) {
      if (on) keys.add(key); else keys.delete(key);
      sync();
    },
    get(nowMs) {
      sync();
      if (!timeline || (status !== 'ready' && status !== 'building')) return null;
      const t = follower.update(audio.currentTime, nowMs, !audio.paused && !audio.ended, audio.playbackRate);
      if (status === 'building' && timeline.done / timeline.rps < t + LOOK_S + LOOK_MARGIN_S) return null;
      return { timeline, time: t };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      keys.clear();
      cancel();
      for (const t of ['loadstart', 'emptied', 'seeked']) audio?.removeEventListener?.(t, onAudio);
    },
  };
}
