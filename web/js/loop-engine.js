export const MIN_LOOP = 0.1;
export const LOOKAHEAD = 0.025;
export const MAX_OVERSHOOT = 2;
export const MAX_WAIT_MS = 250;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const usable = (dur) => num(dur) && dur > 0;
const round3 = (t) => Math.round(t * 1000) / 1000;

export function clampTime(t, dur) {
  if (!num(t)) return 0;
  const top = usable(dur) ? dur : Infinity;
  return round3(Math.min(Math.max(t, 0), top));
}

export function emptyRegion() {
  return { start: null, end: null };
}

export function validRegion(region, dur) {
  if (!region || !num(region.start) || !num(region.end)) return false;
  if (region.start < 0 || region.end - region.start < MIN_LOOP - 1e-9) return false;
  return !usable(dur) || region.end <= dur + 1e-9;
}

export function setMark(region, which, t, dur) {
  const at = clampTime(t, dur);
  const r = { ...emptyRegion(), ...region };
  if (which === 'start') {
    r.start = usable(dur) ? Math.min(at, Math.max(0, round3(dur - MIN_LOOP))) : at;
    if (num(r.end) && r.end - r.start < MIN_LOOP - 1e-9) r.end = null;
  } else {
    r.end = usable(dur) ? Math.max(at, MIN_LOOP) : at;
    if (num(r.start) && r.end - r.start < MIN_LOOP - 1e-9) r.start = null;
  }
  return r;
}

export function nudge(region, which, delta, dur) {
  const r = { ...emptyRegion(), ...region };
  const cur = r[which];
  if (!num(cur)) return r;
  const other = which === 'start' ? r.end : r.start;
  let lo = 0;
  let hi = usable(dur) ? dur : Infinity;
  if (num(other)) {
    if (which === 'start') hi = Math.min(hi, other - MIN_LOOP);
    else lo = other + MIN_LOOP;
  }
  const next = round3(Math.min(Math.max(cur + delta, lo), Math.max(lo, hi)));
  return { ...r, [which]: next };
}

export function decide({ time, region, rate = 1, playing = true, lookahead = LOOKAHEAD }) {
  if (!playing || !validRegion(region) || !num(time)) return { kind: 'idle' };
  const { start, end } = region;
  const left = end - time;
  if (left <= lookahead) return left > -MAX_OVERSHOOT ? { kind: 'seek', to: start } : { kind: 'idle' };
  const speed = num(rate) && rate > 0 ? rate : 1;
  return { kind: 'wait', ms: Math.min(MAX_WAIT_MS, Math.max(0, ((left - lookahead) / speed) * 1000)) };
}

export function fmtClock(t) {
  const v = num(t) && t > 0 ? t : 0;
  const tenths = Math.round(v * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function parseClock(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  const m = /^(?:(\d{1,3}):)?(\d{1,2}(?:\.\d{1,3})?|\.\d{1,3}|\d+)$/.exec(s);
  if (!m) return null;
  const secs = Number(m[2]);
  if (m[1] !== undefined && secs >= 60) return null;
  const t = Number(m[1] ?? 0) * 60 + secs;
  return Number.isFinite(t) ? round3(t) : null;
}

export function createLoop(audio, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) }) {
  let region = emptyRegion();
  let on = false;
  let timer = null;
  let wraps = 0;
  const listeners = new Set();

  const dur = () => audio.duration;
  const snapshot = () => ({ start: region.start, end: region.end, on, active: on && validRegion(region, dur()) });
  const emit = () => { const s = snapshot(); listeners.forEach((fn) => fn(s)); };
  const disarm = () => { if (timer != null) { timers.clear(timer); timer = null; } };

  function tick() {
    disarm();
    if (!on || audio.seeking) return;
    const d = decide({ time: audio.currentTime, region, rate: audio.playbackRate, playing: !audio.paused });
    if (d.kind === 'seek') {
      wraps += 1;
      audio.currentTime = d.to;
    } else if (d.kind === 'wait') {
      timer = timers.set(tick, d.ms);
    }
  }

  function arm() {
    disarm();
    if (on && !audio.paused) tick();
  }

  for (const ev of ['play', 'playing', 'seeked', 'ratechange']) audio.addEventListener(ev, () => { if (on) arm(); });
  audio.addEventListener('timeupdate', () => { if (on) tick(); });
  audio.addEventListener('pause', disarm);

  const change = (next, turnOn = on) => {
    region = next;
    on = turnOn && validRegion(region, dur());
    arm();
    emit();
  };

  return {
    get: snapshot,
    get wraps() { return wraps; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setMark(which, t) { change(setMark(region, which, t, dur())); },
    nudge(which, delta) { change(nudge(region, which, delta, dur())); },
    setRegion(start, end, turnOn = on) {
      const r = { start: clampTime(start, dur()), end: clampTime(end, dur()) };
      change(validRegion(r, dur()) ? r : emptyRegion(), turnOn);
    },
    setOn(next) { change(region, !!next); },
    toggle() { change(region, !on); },
    clear() {
      if (!on && region.start == null && region.end == null) return;
      change(emptyRegion(), false);
    },
    onEnded() {
      const d = dur();
      if (!on || !validRegion(region, d) || region.end < d - 0.25) return false;
      audio.currentTime = region.start;
      audio.play?.();
      return true;
    },
  };
}
