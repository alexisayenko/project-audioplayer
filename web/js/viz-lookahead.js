import {
  createTimeline, downmixMono, makeTimeFollower, createWorkerRunner, createInlineRunner, LOOKAHEAD_MAX_S, LOOKAHEAD_MAX_BYTES,
  markRows, uncoveredSpans, timelineCovers, prefetchDue, statusText, PREFETCH_S,
} from './viz-timeline.js';
import { LOOK_S, HISTORY_BINS, ROWS_PER_SECOND } from './viz-terrain-math.js';

export const LOOK_MARGIN_S = 1.2;
const CACHE_MAX = 4;
const RETRY_MAX = 2;
const RETRY_GAP_MS = 2000;
const FOCUS_AHEAD_S = 10;
const FOCUS_GAP_MS = 1000;
const PREFETCH_GAP_MS = 2000;
const srcOf = (audio) => audio?.currentSrc || audio?.src || '';

function defaultRunner(win) {
  if (typeof win.Worker !== 'function') return createInlineRunner();
  const url = new URL('./viz-timeline-worker.js', import.meta.url);
  return createWorkerRunner(() => new win.Worker(url, { type: 'module' }));
}

export function decodeBuffer(ctx, bytes) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) { reject(err); }
  });
}

export function createLookahead({
  audio, win = globalThis, fetchFn = (...a) => win.fetch(...a), getSampleRate = () => 44100, getBands = () => 300,
  makeRunner = () => defaultRunner(win), makeCtx = (sr) => new (win.OfflineAudioContext || win.webkitOfflineAudioContext)(1, 1, sr),
  maxSeconds = LOOKAHEAD_MAX_S, maxBytes = LOOKAHEAD_MAX_BYTES, getNextSrc = () => '', warn = (...a) => win.console?.warn?.(...a),
} = {}) {
  const keys = new Set();
  const listeners = new Set();
  const follower = makeTimeFollower();
  const cache = new Map();
  let src = '';
  let status = 'idle';
  let stage = '';
  let error = '';
  let cached = false;
  let retries = 0;
  let failedAt = 0;
  let fatal = false;
  let timeline = null;
  let job = null;
  let pre = null;
  let gen = 0;
  let lastFocus = -1e9;
  let lastFocusAt = -1e9;
  let lastPrefetchAt = -1e9;
  const emit = () => { for (const fn of listeners) fn(status); };

  function remember(key, tl, complete) {
    if (!tl || !(tl.done > 0 || tl.ranges?.length)) return;
    cache.delete(key);
    cache.set(key, { tl, complete });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function cancel() {
    gen += 1;
    job?.abort?.abort();
    job?.run?.cancel();
    if (timeline && src) remember(src, timeline, status === 'ready');
    job = null;
    timeline = null;
    src = '';
    status = 'idle';
    stage = '';
    error = '';
    cached = false;
    follower.reset();
  }

  function cancelPre() {
    if (!pre) return;
    pre.abort?.abort();
    pre.run?.cancel();
    pre = null;
  }

  async function fetchDecode(url, abort, setStage) {
    const pre0 = audio.duration;
    if (Number.isFinite(pre0) && pre0 > maxSeconds) throw Object.assign(new Error(`too long: ${Math.round(pre0)} s`), { fatal: true });
    setStage('fetch');
    const res = await fetchFn(url, { credentials: 'same-origin', signal: abort?.signal });
    if (!res.ok) throw Object.assign(new Error(`http ${res.status ?? 'error'}`), { fatal: res.status >= 400 && res.status < 500 });
    const len = Number(res.headers?.get?.('content-length'));
    if (len > maxBytes) throw Object.assign(new Error(`file too big: ${Math.round(len / 1048576)} MB`), { fatal: true });
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw Object.assign(new Error(`file too big: ${Math.round(bytes.byteLength / 1048576)} MB`), { fatal: true });
    return { bytes, setStage };
  }

  async function decode(bytes, setStage) {
    setStage('decode');
    const decoded = await decodeBuffer(makeCtx(getSampleRate()), bytes);
    const seconds = decoded.length / decoded.sampleRate;
    if (seconds > maxSeconds) throw Object.assign(new Error(`too long: ${Math.round(seconds)} s`), { fatal: true });
    return decoded;
  }

  async function load(url, mine, seed) {
    const abort = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    job = { abort, run: null };
    const setStage = (v) => { if (mine === gen) { stage = v; } };
    const fail = (err) => {
      if (mine !== gen) return;
      status = 'failed';
      error = String(err?.message || err || 'unknown');
      fatal = !!err?.fatal;
      failedAt = Date.now();
      timeline = seed && seed.done > 0 ? seed : null;
      job = null;
      warn?.(`[viz] timeline failed: ${error}`);
      emit();
    };
    try {
      const { bytes } = await fetchDecode(url, abort, setStage);
      if (mine !== gen) return;
      const decoded = await decode(bytes, setStage);
      if (mine !== gen) return;
      const pcm = downmixMono(decoded);
      let tl = createTimeline(pcm.length / decoded.sampleRate, HISTORY_BINS, ROWS_PER_SECOND);
      if (!tl.total) throw new Error('empty audio');
      if (seed && seed.total === tl.total && seed.bins === tl.bins) tl = seed;
      timeline = tl;
      status = 'building';
      stage = '';
      const focus = Math.round((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) * tl.rps);
      lastFocus = focus;
      job.run = makeRunner().start(
        { pcm, sampleRate: decoded.sampleRate, bands: getBands(), bins: tl.bins, rps: tl.rps, focus },
        {
          onRows(from, rows, isWin) {
            if (mine !== gen) return;
            const to = from + rows.length / tl.bins;
            if (isWin) tl.data.set(rows, from * tl.bins);
            else for (const [a, b] of uncoveredSpans(tl, from, to)) tl.data.set(rows.subarray((a - from) * tl.bins, (b - from) * tl.bins), a * tl.bins);
            markRows(tl, from, to);
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
          onDone() {
            if (mine !== gen) return;
            markRows(tl, 0, tl.total);
            tl.done = tl.total;
            status = 'ready';
            job = null;
            remember(src, tl, true);
            emit();
          },
          onError(err) { if (mine === gen) { timeline = null; fail(err); } },
        },
      );
      emit();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      fail(err);
    }
  }

  async function runPrefetch(url) {
    const abort = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    const mine = { src: url, abort, run: null };
    pre = mine;
    const alive = () => pre === mine;
    try {
      const { bytes } = await fetchDecode(url, abort, () => {});
      if (!alive()) return;
      const decoded = await decode(bytes, () => {});
      if (!alive()) return;
      const pcm = downmixMono(decoded);
      const tl = createTimeline(pcm.length / decoded.sampleRate, HISTORY_BINS, ROWS_PER_SECOND);
      if (!tl.total) { pre = null; return; }
      const limit = Math.min(tl.total, Math.round(PREFETCH_S * tl.rps));
      await new Promise((resolve, reject) => {
        mine.run = makeRunner().start(
          { pcm, sampleRate: decoded.sampleRate, bands: getBands(), bins: tl.bins, rps: tl.rps, focus: 0, to: limit },
          {
            onRows(from, rows) { if (alive()) { tl.data.set(rows, from * tl.bins); markRows(tl, from, from + rows.length / tl.bins); } },
            onDone: resolve,
            onError: reject,
          },
        );
      });
      if (!alive()) return;
      pre = null;
      if (!cache.has(url)) remember(url, tl, false);
    } catch (err) {
      if (alive()) pre = null;
      if (err?.name !== 'AbortError') warn?.(`[viz] timeline prefetch failed: ${String(err?.message || err)}`);
    }
  }

  function sync() {
    const cur = srcOf(audio);
    if (cur !== src && status !== 'idle') cancel();
    if (!keys.size || !audio) return;
    if (cur === src || !cur) return;
    if (pre && pre.src === cur) cancelPre();
    src = cur;
    retries = 0;
    fatal = false;
    const hit = cache.get(cur);
    if (hit?.complete) {
      timeline = hit.tl;
      status = 'ready';
      cached = true;
      cache.delete(cur);
      cache.set(cur, hit);
      follower.reset();
      return;
    }
    cached = !!hit;
    timeline = hit?.tl ?? null;
    status = 'loading';
    stage = 'fetch';
    error = '';
    void load(cur, gen, hit?.tl ?? null);
  }

  function retry() {
    if (status !== 'failed' || fatal || retries >= RETRY_MAX || !keys.size) return;
    if (Date.now() - failedAt < RETRY_GAP_MS) return;
    const seed = timeline;
    retries += 1;
    const n = retries;
    const s = src;
    status = 'loading';
    stage = 'fetch';
    error = '';
    job = null;
    gen += 1;
    void load(s, gen, seed).then(() => { retries = n; });
  }

  const onAudio = (ev) => {
    if (!keys.size) { sync(); return; }
    sync();
    if (ev?.type === 'seeked' && job?.run?.focus) {
      const row = Math.round(audio.currentTime * (timeline?.rps ?? ROWS_PER_SECOND));
      job.run.focus(row);
      lastFocus = row;
    }
    retry();
    emit();
  };
  const evs = ['loadstart', 'emptied', 'seeked', 'loadedmetadata', 'canplay'];
  for (const t of evs) audio?.addEventListener?.(t, onAudio);

  function steer(t, nowMs) {
    const tl = timeline;
    if (status !== 'building' || !job?.run?.focus) return;
    const row = Math.round(t * tl.rps);
    if (timelineCovers(tl, t - 1, t + FOCUS_AHEAD_S)) return;
    if (Math.abs(row - lastFocus) > 2 * tl.rps || nowMs - lastFocusAt > FOCUS_GAP_MS) {
      job.run.focus(row);
      lastFocus = row;
      lastFocusAt = nowMs;
    }
  }

  function maybePrefetch(nowMs) {
    if (nowMs - lastPrefetchAt < PREFETCH_GAP_MS) return;
    lastPrefetchAt = nowMs;
    const nextSrc = getNextSrc?.() || '';
    if (!prefetchDue({ on: keys.size > 0, nextSrc: nextSrc && nextSrc !== src ? nextSrc : '', cached: cache.has(nextSrc), status, busy: !!pre })) return;
    if (status !== 'ready') return;
    void runPrefetch(nextSrc);
  }

  return {
    get status() { return status; },
    get timeline() { return timeline; },
    statusText() {
      const tl = timeline;
      return statusText({ status, error, done: tl?.done ?? 0, total: tl?.total ?? 0, cached, stage });
    },
    request(key, on) {
      if (on) keys.add(key); else keys.delete(key);
      sync();
    },
    get(nowMs) {
      sync();
      if (!timeline || (status !== 'ready' && status !== 'building' && status !== 'loading')) return null;
      const tl = timeline;
      const t = follower.update(audio.currentTime, nowMs, !audio.paused && !audio.ended, audio.playbackRate);
      steer(t, nowMs);
      maybePrefetch(nowMs);
      const want = t + LOOK_S + LOOK_MARGIN_S;
      const prefix = status === 'ready' || tl.done >= tl.total || tl.done / tl.rps >= want;
      if (!prefix) {
        const a = Math.max(0, Math.floor((t - 1) * tl.rps));
        const b = Math.min(tl.total, Math.ceil(want * tl.rps) + 1);
        const gap = uncoveredSpans(tl, a, b).reduce((n, [x, y]) => n + y - x, 0);
        if (gap >= b - a) return null;
      }
      return { timeline: tl, time: t, partial: !prefix };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      keys.clear();
      cancelPre();
      cancel();
      for (const t of evs) audio?.removeEventListener?.(t, onAudio);
    },
  };
}
