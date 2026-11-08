import { mark as perfMark } from './perf.js';

export const WARM_GAP_MS = 5000;
export const NEXT_DELAY_MS = 2000;
const KEEP = 64;

// A 2-byte Range request: warms the connection and the server's song index without touching any player state (PLY-209).
export function createWarmer({
  urlOf,
  fetchFn = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  canPrepare = () => true,
  canProbeNext = () => true,
  mark = perfMark,
} = {}) {
  const last = new Map();

  function probe(id, kind, priority) {
    const t = now();
    const prev = last.get(id);
    if (prev != null && t - prev < WARM_GAP_MS) return null;
    last.set(id, t);
    if (last.size > KEEP) last.delete(last.keys().next().value);
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    mark(kind, id);
    try {
      const done = fetchFn(urlOf(id), { headers: { Range: 'bytes=0-1' }, credentials: 'same-origin', priority, signal: ac?.signal });
      Promise.resolve(done).then((r) => r?.body?.cancel?.(), () => {}).catch(() => {});
    } catch { /* a warm-up never throws */ }
    return () => ac?.abort();
  }

  return {
    prepare: (id) => (id && canPrepare(id) ? probe(id, 'prepare', 'high') : null),
    probeNext: (id) => (id && canProbeNext(id) ? probe(id, 'next-probe', 'low') : null),
  };
}

// Starts a prepare on the press of a row Play button; mouse and pen on pointerdown, touch on touchstart (a scroll cancels it).
export function watchRowPress(doc, prepare) {
  let active = null;
  const cancel = () => {
    const a = active;
    active = null;
    a?.cancel?.();
  };
  const start = (e) => {
    const btn = e.target?.closest?.('.row-cover.act-play');
    const id = btn?.closest?.('li[data-id]')?.dataset?.id;
    if (!btn || !id) return;
    cancel();
    active = { btn, cancel: prepare(id) };
  };
  doc.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') start(e); }, true);
  doc.addEventListener('pointercancel', cancel, true);
  doc.addEventListener('pointerleave', (e) => { if (active && e.target === active.btn) cancel(); }, true);
  doc.addEventListener('pointerup', (e) => {
    if (active && !active.btn.contains?.(e.target)) cancel();
    active = null;
  }, true);
  doc.addEventListener('touchstart', start, { capture: true, passive: true });
  doc.addEventListener('touchmove', cancel, { capture: true, passive: true });
  doc.addEventListener('touchcancel', cancel, true);
  doc.addEventListener('touchend', () => { active = null; }, true);
  return cancel;
}

// Once per song, after it has played for `delayMs`, asks `probe` to warm the next song.
export function watchNextProbe({
  audio,
  currentId,
  peekNext,
  probe,
  enabled = () => true,
  delayMs = NEXT_DELAY_MS,
  setT = (f, ms) => setTimeout(f, ms),
  clearT = (t) => clearTimeout(t),
}) {
  let timer = null;
  let done = null;
  const clear = () => {
    if (timer == null) return;
    clearT(timer);
    timer = null;
  };
  const arm = () => {
    const id = currentId();
    if (!id || done === id || timer != null) return;
    timer = setT(() => {
      timer = null;
      if (audio.paused || currentId() !== id || done === id || !enabled()) return;
      done = id;
      const next = peekNext();
      if (next) probe(next);
    }, delayMs);
  };
  audio.addEventListener('playing', arm);
  for (const ev of ['pause', 'emptied', 'loadstart', 'abort']) audio.addEventListener(ev, clear);
  return clear;
}

export const saveDataOn = (nav = globalThis.navigator) => {
  try {
    return nav?.connection?.saveData === true;
  } catch {
    return false;
  }
};
