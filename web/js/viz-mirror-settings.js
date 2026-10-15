import { storeGet, storeSet } from './storage.js';
import { repairField } from './viz-synth-settings.js';

export const MIRROR_KEY = 'ap2.viz.mirror';
export const MIRROR_VERSION = 1;

const f = (key, group, label, type, def, o = {}) => ({ key, group, label, type, def, ...o });
const range = (key, group, label, min, max, step, def) => f(key, group, label, 'range', def, { min, max, step });
const select = (key, group, label, options, def) => f(key, group, label, 'select', def, { options });
const bool = (key, group, label, def) => f(key, group, label, 'bool', def);

export const MIRROR_SCHEMA = [
  range('density', 'Bars', 'Bar count', 0.5, 2, 0.05, 1),
  range('width', 'Bars', 'Bar width', 0.3, 0.95, 0.05, 0.6),
  range('height', 'Bars', 'Height', 0.4, 1.2, 0.05, 1),
  range('rise', 'Motion', 'Rise speed', 0.1, 1, 0.05, 0.6),
  range('fall', 'Motion', 'Fall speed', 0.03, 0.5, 0.01, 0.15),
  select('gradient', 'Look', 'Colours', ['theme', 'reversed', 'accent'], 'theme'),
  range('reflection', 'Look', 'Reflection', 0, 0.8, 0.05, 0.35),
  bool('horizon', 'Look', 'Horizon glow', true),
];

export const MIRROR_GROUPS = [...new Set(MIRROR_SCHEMA.map((s) => s.group))];

const FIELD = new Map(MIRROR_SCHEMA.map((s) => [s.key, s]));

export function defaultMirror() {
  return Object.fromEntries(MIRROR_SCHEMA.map((s) => [s.key, s.def]));
}

export function validateMirror(raw) {
  let src = raw;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return defaultMirror(); }
  }
  const out = defaultMirror();
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  if (src.v !== undefined && src.v !== MIRROR_VERSION) return out;
  for (const s of MIRROR_SCHEMA) if (s.key in src) out[s.key] = repairField(s, src[s.key]);
  return out;
}

const listeners = new Set();
let current = null;
let version = 0;

function commit(next, key) {
  current = next;
  version += 1;
  storeSet(MIRROR_KEY, JSON.stringify({ v: MIRROR_VERSION, ...current }));
  for (const cb of [...listeners]) cb(current, key);
}

export const mirrorVersion = () => version;

export function getMirror() {
  current ??= validateMirror(storeGet(MIRROR_KEY));
  return current;
}

export function setMirror(key, value) {
  const spec = FIELD.get(key);
  if (!spec) return undefined;
  const v = repairField(spec, value);
  const cur = getMirror();
  if (cur[key] !== v) commit({ ...cur, [key]: v }, key);
  return v;
}

export function replaceMirror(raw) {
  const next = validateMirror(raw);
  commit(next, '*');
  return next;
}

export function resetMirror(group) {
  const cur = getMirror();
  const next = { ...cur };
  let changed = false;
  for (const s of MIRROR_SCHEMA) {
    if (group && s.group !== group) continue;
    if (next[s.key] !== s.def) { next[s.key] = s.def; changed = true; }
  }
  if (changed) commit(next, group ?? '*');
  return getMirror();
}

export function onMirror(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const colorCache = new WeakMap();

export function mirrorColors(colors, gradient) {
  if (gradient === 'theme' || !colors?.stops) return colors;
  const hit = colorCache.get(colors);
  if (hit?.gradient === gradient) return hit.value;
  const stops = gradient === 'reversed' ? [...colors.stops].reverse() : colors.stops.map(() => colors.accent);
  const value = { ...colors, stops, a: stops[0], b: stops.at(-1) };
  colorCache.set(colors, { gradient, value });
  return value;
}

export function resetMirrorForTests() {
  current = null;
  version = 0;
  listeners.clear();
}
