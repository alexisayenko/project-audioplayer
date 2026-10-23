export const END_WINDOW_S = 3;
export const END_WINDOW_FRAC = 0.02;
export const END_STALL_S = 1;
export const WATCH_MS = 1000;

const known = (n) => typeof n === 'number' && Number.isFinite(n);

/** True when the playhead is in the last few seconds (or last 2 %) of a song with a known length. */
export function nearEnd(audio) {
  const d = audio.duration;
  const t = audio.currentTime;
  if (!known(d) || !known(t) || d <= 0) return false;
  return d - t <= Math.max(END_WINDOW_S, d * END_WINDOW_FRAC);
}

/** Makes sure a song that reached its end always runs the end-of-song path, even when the browser never fires `ended` (a cut stream, a stalled tail). */
export function createEndGuard({ audio, timers = { set: (fn, ms) => { const id = setInterval(fn, ms); id?.unref?.(); return id; }, clear: (id) => clearInterval(id) } }) {
  let done = false;
  let last = -1;
  let timer = null;

  const reset = () => { done = false; last = -1; };

  function finish() {
    if (done) return false;
    done = true;
    if (!audio.paused) audio.pause();
    audio.dispatchEvent(new Event('ended'));
    return true;
  }

  function tick() {
    if (done) return;
    if (audio.ended) { finish(); return; }
    const d = audio.duration;
    const t = audio.currentTime;
    if (audio.paused || audio.seeking || !known(d) || d <= 0) { last = -1; return; }
    const stuck = t === last;
    last = t;
    if (stuck && d - t <= END_STALL_S) finish();
  }

  audio.addEventListener('ended', () => { done = true; });
  for (const ev of ['seeking', 'loadstart', 'emptied']) audio.addEventListener(ev, reset);
  timer = timers.set(tick, WATCH_MS);

  return {
    finish,
    tick,
    stop() { if (timer !== null) timers.clear(timer); timer = null; },
    get done() { return done; },
  };
}
