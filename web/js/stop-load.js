import { storeGet } from './storage.js';
import { hasGraph } from './audio-graph.js';

export const SWITCH_KEY = 'ap2.switch';
export const SWITCH_MODES = ['auto', 'always', 'off'];
const TAIL_S = 0.5;

/** `off` (the default): let the source change end the previous download; `auto`: end it first when it is still running; `always`: also when it is complete. Opt-in from the latency meter: in Safari an element routed through Web Audio was silent after this stop (2026-11-09). */
export function switchMode(read = storeGet) {
  const v = read(SWITCH_KEY);
  return SWITCH_MODES.includes(v) ? v : 'off';
}

/** True while the element still has bytes of its current source to fetch: a source is set and the buffered range does not reach the end. */
export function stillLoading(audio) {
  if (!audio.getAttribute('src')) return false;
  const dur = audio.duration;
  const b = audio.buffered;
  if (!Number.isFinite(dur) || !b?.length) return true;
  return b.end(b.length - 1) < dur - TAIL_S;
}

/**
 * Before a new song's source is set: ends the previous song's download now (empty source, then load) instead of leaving it to the source change, so its remaining range request never shares the connection with the new song's first one (PLY-214). Returns true when it did.
 */
export function stopLoading(audio, mode = switchMode(), routed = hasGraph()) {
  if (routed || mode === 'off' || !audio.getAttribute('src')) return false;
  if (mode === 'auto' && !stillLoading(audio)) return false;
  audio.removeAttribute('src');
  audio.load();
  return true;
}
