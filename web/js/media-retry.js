import { MEDIA_RETRY_DELAYS_MS } from './constants.js';

const RETRYABLE = new Set([2, 4]);

async function defaultProbe(src) {
  try {
    const r = await fetch(src, { headers: { Range: 'bytes=0-0' } });
    return r.status >= 400 && r.status < 500 ? 'gone' : 'retry';
  } catch {
    return 'retry';
  }
}

/** Reloads the same source with backoff when the media request fails (a 502 during a deploy, a dropped connection); state is 'ok', 'reconnecting' or 'failed'. */
export function createMediaRetry({ audio, onChange = () => {}, onGone = () => {}, delays = MEDIA_RETRY_DELAYS_MS, probe = defaultProbe, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } }) {
  let state = 'ok';
  let attempt = 0;
  let timer = null;
  let src = '';
  let at = 0;
  let want = false;
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
    seq += 1;
    setState('ok');
  }

  function reload() {
    audio.src = src;
    if (at > 0) {
      const seek = () => { audio.removeEventListener('loadedmetadata', seek); audio.currentTime = at; };
      audio.addEventListener('loadedmetadata', seek);
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
    want = !audio.paused;
    const my = ++seq;
    Promise.resolve(probe(src)).then((verdict) => {
      if (my !== seq) return;
      if (verdict === 'gone') { setState('ok'); onGone(); } else schedule();
    });
  }

  audio.addEventListener('error', () => {
    const current = audio.getAttribute?.('src') || audio.src;
    if (!current) return;
    if (!RETRYABLE.has(audio.error?.code)) { onGone(); return; }
    if (timer !== null) return;
    if (attempt === 0 && state === 'ok') begin(current);
    else if (current === src) schedule();
    else begin(current);
  });
  audio.addEventListener('playing', () => {
    if (state === 'ok' && attempt === 0) return;
    attempt = 0;
    at = 0;
    setState('ok');
  });
  audio.addEventListener('pause', () => {
    if (state !== 'ok' || timer !== null) cancel();
  });

  return {
    get state() { return state; },
    stalled: () => state !== 'ok',
    reset: cancel,
    retryNow() {
      if (state !== 'failed') return;
      attempt = 0;
      setState('reconnecting');
      reload();
    },
  };
}
