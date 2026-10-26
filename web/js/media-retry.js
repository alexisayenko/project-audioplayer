import { MEDIA_RETRY_DELAYS_MS } from './constants.js';

const RETRYABLE = new Set([2, 4]);
const STABLE_S = 5;

async function defaultProbe(src) {
  try {
    const r = await fetch(src, { headers: { Range: 'bytes=0-0' } });
    return r.status >= 400 && r.status < 500 ? 'gone' : 'retry';
  } catch {
    return 'retry';
  }
}

/** Reloads the same source with backoff when the media request fails (a 502 during a deploy, a dropped connection); state is 'ok', 'reconnecting' or 'failed'. A failure in the last seconds of the song calls `onEnd` instead (the song counts as finished). */
export function createMediaRetry({ audio, onChange = () => {}, onGone = () => {}, nearEnd = () => false, onEnd = () => {}, delays = MEDIA_RETRY_DELAYS_MS, probe = defaultProbe, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } }) {
  let state = 'ok';
  let attempt = 0;
  let timer = null;
  let src = '';
  let at = 0;
  let want = false;
  let intent = false;
  let stableFrom = 0;
  let seeker = null;
  let seq = 0;

  const setState = (next) => {
    if (next === state) return;
    state = next;
    onChange(next);
  };

  function cancel() {
    if (timer !== null) timers.clear(timer);
    timer = null;
    attempt = 0;
    at = 0;
    if (seeker) audio.removeEventListener('loadedmetadata', seeker);
    seeker = null;
    seq += 1;
    setState('ok');
  }

  function reload() {
    audio.src = src;
    if (seeker) audio.removeEventListener('loadedmetadata', seeker);
    seeker = null;
    if (at > 0) {
      const target = at;
      seeker = () => { audio.removeEventListener('loadedmetadata', seeker); seeker = null; audio.currentTime = target; };
      audio.addEventListener('loadedmetadata', seeker);
    }
    if (want) audio.play?.()?.catch?.(() => {});
  }

  function schedule() {
    if (attempt >= delays.length) { setState('failed'); return; }
    setState('reconnecting');
    const my = seq;
    timer = timers.set(() => {
      timer = null;
      if (my === seq) reload();
    }, delays[attempt]);
    attempt += 1;
  }

  function begin(current) {
    src = current;
    at = audio.currentTime > 0 ? audio.currentTime : at;
    want = intent || !audio.paused;
    const my = ++seq;
    void Promise.resolve(probe(src)).catch(() => 'retry').then((verdict) => {
      if (my !== seq) return;
      if (verdict === 'gone') { setState('ok'); onGone(); } else schedule();
    }).catch(() => setState('failed'));
  }

  audio.addEventListener('error', () => {
    const current = audio.getAttribute?.('src') || audio.src;
    if (!current) return;
    if (nearEnd()) { cancel(); onEnd(); return; }
    if (!RETRYABLE.has(audio.error?.code)) { onGone(); return; }
    if (timer !== null) return;
    if (attempt === 0 && state === 'ok') begin(current);
    else if (current === src) {
      if (audio.currentTime > 0) at = audio.currentTime;
      schedule();
    } else begin(current);
  });
  function recovered() {
    if (state === 'ok' && attempt === 0) return;
    stableFrom = audio.currentTime;
    setState('ok');
  }
  audio.addEventListener('play', () => { intent = true; });
  audio.addEventListener('playing', recovered);
  audio.addEventListener('timeupdate', () => {
    if (attempt > 0 && state === 'ok' && timer === null && audio.currentTime - stableFrom >= STABLE_S) { attempt = 0; at = 0; }
  });
  audio.addEventListener('loadedmetadata', () => { if (audio.paused && timer === null && !want) recovered(); });
  audio.addEventListener('pause', () => {
    if (audio.error) return;
    intent = false;
    if (state !== 'ok' || timer !== null) cancel();
  });

  return {
    get state() { return state; },
    stalled: () => state !== 'ok',
    reset() { intent = false; cancel(); },
    retryNow() {
      if (state !== 'failed') return;
      attempt = 0;
      setState('reconnecting');
      reload();
    },
  };
}
