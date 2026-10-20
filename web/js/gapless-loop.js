import * as realGraph from './audio-graph.js';

export const MAX_BYTES = 24 * 1024 * 1024;
export const MAX_SECONDS = 600;
export const DRIFT = 0.12;
export const EDGE = 0.03;
const SELF_TOLERANCE = 0.05;

async function fetchBytes(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`file ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) { res.body?.cancel?.(); throw new Error('file too large to decode here'); }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error('file too large to decode here');
  return bytes;
}

export function createGapless({ audio, graph = realGraph, fetchBytes: load = fetchBytes }) {
  const listeners = new Set();
  const hooked = new WeakSet();
  let want = null;
  let status = 'idle';
  let key = null;
  let buffer = null;
  let token = 0;
  let node = null;
  let elem = null;
  let vol = null;
  let lo = 0;
  let hi = 0;
  let t0 = 0;
  let o0 = 0;
  let selfTarget = null;
  let pendingUser = false;

  const ctx = () => graph.getContext();
  const running = () => graph.hasGraph() && ctx()?.state === 'running';
  const srcKey = () => audio.src ?? '';
  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    listeners.forEach((fn) => fn());
  };

  const position = () => {
    if (!node) return null;
    const p = o0 + (ctx().currentTime - t0);
    return p < hi ? p : lo + ((p - lo) % (hi - lo));
  };

  function markSelf(t) {
    selfTarget = t;
  }

  function seekElement(t) {
    markSelf(t);
    audio.currentTime = t;
  }

  function syncVolume() {
    if (vol) vol.gain.value = audio.muted ? 0 : audio.volume;
  }

  function route() {
    if (elem) return true;
    const source = graph.getSource?.();
    const c = ctx();
    const out = graph.getGain();
    if (!source || !c || !out) return false;
    elem = c.createGain();
    vol = c.createGain();
    source.disconnect();
    source.connect(elem);
    elem.connect(out);
    vol.connect(out);
    return true;
  }

  function stopNode() {
    if (!node) return;
    try { node.stop(); } catch { /* already stopped */ }
    try { node.disconnect(); } catch { /* already disconnected */ }
    node = null;
  }

  function startAt(p) {
    stopNode();
    const c = ctx();
    node = c.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.loopStart = lo;
    node.loopEnd = hi;
    node.connect(vol);
    syncVolume();
    o0 = p;
    t0 = c.currentTime;
    node.start(0, p);
    elem.gain.value = 0;
  }

  function disengage(toElement) {
    if (!node) return;
    const p = position();
    stopNode();
    if (toElement && p != null && !audio.ended && Math.abs(audio.currentTime - p) > 0.02) seekElement(p);
    if (elem) elem.gain.value = 1;
  }

  function engage(e, r) {
    if (!route()) return;
    lo = r.start;
    hi = r.end;
    startAt(e);
  }

  function correctElement(e) {
    const q = position();
    const len = hi - lo;
    let bad = e >= hi + SELF_TOLERANCE || e < lo - SELF_TOLERANCE;
    if (!bad && len >= 4 * DRIFT) {
      const off = (((e - q + len / 2) % len) + len) % len - len / 2;
      bad = Math.abs(off) > DRIFT;
    }
    if (bad) seekElement(q);
  }

  function apply() {
    const r = want;
    if (!r) return;
    if (node && audio.ended) return;
    const e = audio.currentTime;
    const playable = !audio.paused && (audio.playbackRate || 1) === 1 && running();
    if (!playable) {
      pendingUser = false;
      disengage(true);
      return;
    }
    if (!node) {
      pendingUser = false;
      if (e >= r.start && e < r.end - EDGE) engage(e, r);
      return;
    }
    syncVolume();
    if (pendingUser) {
      pendingUser = false;
      if (e >= lo && e < hi - EDGE) startAt(e);
      else disengage(false);
      if (!node) return;
    }
    if (lo !== r.start || hi !== r.end) {
      const q = position();
      lo = r.start;
      hi = r.end;
      if (q >= lo && q < hi) {
        o0 = q;
        t0 = ctx().currentTime;
        node.loopStart = lo;
        node.loopEnd = hi;
      } else {
        startAt(lo);
      }
    }
    correctElement(audio.currentTime);
  }

  async function ready() {
    if (!graph.isSupported?.()) return false;
    graph.unlock(audio);
    if (!graph.hasGraph()) await graph.resume();
    const c = ctx();
    if (c && !hooked.has(c)) {
      hooked.add(c);
      c.addEventListener?.('statechange', () => { if (want) apply(); });
    }
    return running();
  }

  async function prepare() {
    const my = ++token;
    const k = key;
    setStatus('preparing');
    try {
      if (Number.isFinite(audio.duration) && audio.duration > MAX_SECONDS) throw new Error('song too long to decode here');
      if (!(await ready())) throw new Error('no audio graph');
      const bytes = await load(k);
      if (my !== token) return;
      const decoded = await ctx().decodeAudioData(bytes);
      if (my !== token) return;
      if (!decoded || decoded.duration > MAX_SECONDS + 1) throw new Error('song too long to decode here');
      buffer = decoded;
      setStatus('ready');
      apply();
    } catch {
      if (my !== token) return;
      buffer = null;
      setStatus('failed');
    }
  }

  function reset() {
    token += 1;
    disengage(true);
    buffer = null;
    key = null;
    pendingUser = false;
    selfTarget = null;
    setStatus('idle');
  }

  return {
    get status() { return status; },
    get engaged() { return node !== null; },
    get position() { return position(); },
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    markSelf,
    noteSeeked() {
      const own = selfTarget != null && Math.abs(audio.currentTime - selfTarget) < SELF_TOLERANCE;
      selfTarget = null;
      if (!own) pendingUser = true;
    },
    sync(region) {
      if (!region) {
        want = null;
        if (status !== 'idle' || node) reset();
        return;
      }
      want = region;
      const k = srcKey();
      if (k !== key) {
        token += 1;
        disengage(false);
        buffer = null;
        key = k;
        void prepare();
        return;
      }
      if (status === 'ready') apply();
    },
  };
}
