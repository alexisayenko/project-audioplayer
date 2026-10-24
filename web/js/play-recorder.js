import { storeGet, storeSet, storeRemove } from './storage.js';

export const MIN_PLAY_S = 5;
export const MAX_TICK_S = 1.5;
export const FLUSH_MS = 180000;
export const QUEUE_CAP = 1000;
export const BATCH_MAX = 200;
export const QUEUE_KEY = 'ap2.plays.queue';
export const BATCH_KEY = 'ap2.plays.batch';
export const OPEN_KEY = 'ap2.plays.open';
export const LAST_KEY = 'ap2.plays.last';
export const CONT_WINDOW_MS = 600000;
export const LOG_KEY = 'ap2.plays.log';
export const LOG_CAP = 40;
const TRACKED = ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'waiting', 'stalled', 'emptied', 'loadstart', 'abort', 'error', 'durationchange'];

const DROP_STATUSES = new Set([400, 404, 409, 410, 413, 422]);

export function newBatchKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(12));
  return `b${Date.now().toString(36)}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function readJson(key, fallback) {
  try {
    const v = JSON.parse(storeGet(key) || 'null');
    return v ?? fallback;
  } catch { return fallback; }
}

const validPlay = (p) => p && typeof p.song_id === 'string' && typeof p.timestamp === 'string' && Number.isFinite(p.listened_s);

export function createPlayRecorder({
  audio,
  getSongId,
  canRecord = () => true,
  post,
  onFlushed = () => {},
  now = () => new Date(),
  keyFn = newBatchKey,
  intervalMs = FLUSH_MS,
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
} = {}) {
  let open = null;
  let lastT = null;
  let openSrc = null;
  let lastEvent = '';
  let mismatchLogged = null;
  const note = (e) => { lastEvent = e?.type ?? lastEvent; };
  function log(ev, reason, extra = {}) {
    try {
      const src = String(audio.src ?? '');
      const entry = { t: new Date().toISOString(), ev, reason, id: open?.song_id ?? null, src: src.slice(-40), cur: Math.round(audio.currentTime || 0), len: Math.round(open?.listened_s || 0), lastEvent, ...extra };
      const all = readJson(LOG_KEY, []);
      storeSet(LOG_KEY, JSON.stringify([...(Array.isArray(all) ? all : []), entry].slice(-LOG_CAP)));
    } catch { /* diagnostics never throw */ }
  }
  const srcOf = () => audio.getAttribute?.('src') ?? audio.src ?? null;
  let inflight = false;
  let timer = null;

  const loadQueue = () => readJson(QUEUE_KEY, []).filter(validPlay);
  const saveQueue = (q) => {
    if (q.length) storeSet(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_CAP)));
    else storeRemove(QUEUE_KEY);
  };

  function enqueue(play) {
    if (play.listened_s < MIN_PLAY_S) return;
    const rec = { timestamp: play.timestamp, song_id: play.song_id, listened_s: Math.round(play.listened_s * 10) / 10 };
    if (play.cont === true) rec.cont = true;
    saveQueue([...loadQueue(), rec]);
  }

  function recover() {
    const left = readJson(OPEN_KEY, null);
    storeRemove(OPEN_KEY);
    if (validPlay(left)) enqueue(left);
  }

  function persistOpen() {
    if (open && open.listened_s >= MIN_PLAY_S) storeSet(OPEN_KEY, JSON.stringify(open));
  }

  function begin(id) {
    if (!id || !canRecord()) return;
    open = { timestamp: now().toISOString(), song_id: id, listened_s: 0 };
    openSrc = srcOf();
    const last = readJson(LAST_KEY, null);
    storeRemove(LAST_KEY);
    if (last && last.song_id === id && now().getTime() - last.at <= CONT_WINDOW_MS) open.cont = true;
    lastT = null;
    log('open', open.cont ? 'cont' : 'other');
  }

  function end(reason = 'other') {
    if (!open) return false;
    log('close', reason);
    const play = open;
    open = null;
    lastT = null;
    storeRemove(OPEN_KEY);
    storeRemove(LAST_KEY);
    enqueue(play);
    return play.listened_s >= MIN_PLAY_S;
  }

  function sync() {
    const id = getSongId();
    if (open && id && open.song_id !== id) {
      if (openSrc && srcOf() === openSrc) {
        if (mismatchLogged !== id) { mismatchLogged = id; log('ignored', 'id-flicker', { id2: id }); }
      } else {
        end(openSrc ? 'src-change' : 'id-change');
        flush();
      }
    } else mismatchLogged = null;
    if (!open && id && !audio.paused && canRecord()) begin(id);
  }

  function tick() {
    sync();
    if (!open || audio.paused) { lastT = null; return; }
    const t = audio.currentTime;
    if (lastT !== null) {
      const d = t - lastT;
      if (d > 0 && d <= MAX_TICK_S) open.listened_s += d;
    }
    lastT = t;
  }

  async function flush({ keepalive = false } = {}) {
    if (inflight || !canRecord()) return;
    let batch = readJson(BATCH_KEY, null);
    if (!batch || !Array.isArray(batch.plays) || !batch.key) {
      const q = loadQueue();
      if (!q.length) return;
      batch = { batch_key: keyFn(), plays: q.slice(0, BATCH_MAX) };
      saveQueue(q.slice(BATCH_MAX));
      storeSet(BATCH_KEY, JSON.stringify({ key: batch.batch_key, plays: batch.plays }));
    } else {
      batch = { batch_key: batch.key, plays: batch.plays };
    }
    inflight = true;
    try {
      await post(batch, { keepalive });
      storeRemove(BATCH_KEY);
      try { onFlushed(); } catch { /* listener failure is not a recording failure */ }
    } catch (ex) {
      if (DROP_STATUSES.has(ex?.status)) storeRemove(BATCH_KEY);
    } finally {
      inflight = false;
    }
  }

  const onPlay = () => { tick(); };
  const onPause = () => {
    tick();
    lastT = null;
    persistOpen();
    flush();
  };
  const onEnded = () => {
    tick();
    end('ended');
    flush();
  };
  const onSeek = () => { lastT = null; };
  const onHidden = () => {
    tick();
    log('info', 'hide');
    persistOpen();
    flush({ keepalive: true });
  };
  const onPageHide = () => {
    tick();
    if (open && open.listened_s >= MIN_PLAY_S) {
      const closed = open;
      log('close', 'pagehide');
      enqueue(closed);
      storeRemove(OPEN_KEY);
      storeSet(LAST_KEY, JSON.stringify({ song_id: closed.song_id, at: now().getTime() }));
      open = { timestamp: now().toISOString(), song_id: closed.song_id, listened_s: 0, cont: true };
      lastT = null;
    }
    flush({ keepalive: true });
  };
  const onVisibility = () => { if (doc?.visibilityState === 'hidden') onHidden(); };

  audio.addEventListener('play', onPlay);
  audio.addEventListener('playing', onPlay);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('timeupdate', tick);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('seeking', onSeek);
  audio.addEventListener('seeked', onSeek);
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', onPageHide);
  for (const n of TRACKED) audio.addEventListener(n, note);
  if (win) win.apPlaysLog = () => storeGet(LOG_KEY);
  recover();
  timer = setInterval(() => { persistOpen(); flush(); }, intervalMs);
  timer?.unref?.();
  flush();

  return {
    sync,
    flush,
    get open() { return open; },
    recentPlays() {
      const b = readJson(BATCH_KEY, null);
      const sent = b && Array.isArray(b.plays) ? b.plays.filter(validPlay) : [];
      return { plays: [...sent, ...loadQueue()], open: open ? { ...open } : null };
    },
    destroy() {
      clearInterval(timer);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', tick);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('seeking', onSeek);
      audio.removeEventListener('seeked', onSeek);
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
      for (const n of TRACKED) audio.removeEventListener(n, note);
    },
  };
}
