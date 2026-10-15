import { storeGet, storeSet } from './storage.js';
import { repairField } from './viz-synth-settings.js';
import { barCount } from './viz-spectrum.js';
import { MIGRATE_REF_WIDTH, MIGRATE_REF_HALF, BAR_WIDTH_FRACTION, HEIGHT_MAX } from './viz-constants.js';

export const MIRROR_KEY = 'ap2.viz.mirror';
export const MIRROR_VERSION = 1;

const f = (key, group, label, type, def, o = {}) => ({ key, group, label, type, def, ...o });
const range = (key, group, label, min, max, step, def) => f(key, group, label, 'range', def, { min, max, step });
const select = (key, group, label, options, def) => f(key, group, label, 'select', def, { options });
const bool = (key, group, label, def) => f(key, group, label, 'bool', def);

export const MIRROR_SCHEMA = [
  f('barWidth', 'Bars', 'Bar width (px)', 'range', 0, { min: 0, max: 80, step: 1, zero: 'Auto', floor: 2 }),
  range('gap', 'Bars', 'Gap (px)', 0, 20, 1, 2),
  f('maxHeight', 'Bars', 'Max bar height (px)', 'range', 0, { min: 0, max: 600, step: 5, zero: 'Auto', floor: 20 }),
  range('segments', 'Sections', 'LED sections (0 = solid; unused when Section height is set)', 0, 48, 1, 0),
  range('segmentGap', 'Sections', 'Section gap', 0.1, 0.6, 0.05, 0.3),
  f('sectionHeight', 'Sections', 'Section height (px) (0 = use LED sections count)', 'range', 0, { min: 0, max: 80, step: 1, zero: 'Use count', floor: 6 }),
  range('peak', 'Sections', 'Peak marker', 0, 1, 0.05, 0),
  range('peakHold', 'Sections', 'Peak hold (s)', 0.1, 2, 0.1, 0.6),
  range('afterimage', 'Sections', 'Afterimage', 0, 1, 0.05, 0),
  range('afterTau', 'Sections', 'Afterimage fade (s)', 0.1, 1.5, 0.05, 0.35),
  range('shadeJitter', 'Sections', 'Tone variation', 0, 0.15, 0.01, 0),
  select('sectorMode', 'History trail', 'Current sector', ['off', 'trail'], 'off'),
  range('minDwell', 'History trail', 'Minimum dwell (ms)', 0, 300, 10, 60),
  range('visitsPerStep', 'History trail', 'Visits per step', 1, 30, 1, 3),
  range('window', 'History trail', 'Window (s)', 2, 60, 1, 10),
  range('maxLevel', 'History trail', 'Max level', 1, 12, 1, 6),
  range('glow', 'History trail', 'Glow', 0, 1, 0.05, 0.8),
  range('glowSize', 'History trail', 'Glow size', 0.5, 2, 0.1, 1),
  range('trailMax', 'History trail', 'Trail brightness', 0.3, 1, 0.05, 0.8),
  bool('tips', 'Bar tips', 'Show bar tips', false),
  range('tipFade', 'Bar tips', 'Fading speed', 0.05, 1, 0.05, 0.3),
  range('rise', 'Motion', 'Rise speed', 0.1, 1, 0.05, 0.6),
  range('fall', 'Motion', 'Fall speed', 0.03, 0.5, 0.01, 0.15),
  select('gradient', 'Look', 'Colours', ['theme', 'reversed', 'accent', 'ice', 'ice-reversed', 'ice2'], 'theme'),
  select('direction', 'Look', 'Gradient direction', ['horizontal', 'vertical'], 'horizontal'),
  range('reflection', 'Look', 'Reflection', 0, 0.8, 0.05, 0.35),
  bool('horizon', 'Look', 'Horizon glow', true),
  range('band', 'Look', 'Horizon band', 0, 1, 0.05, 0),
  range('baseGlow', 'Look', 'Base row glow', 0, 1, 0.05, 0),
  range('mirrorGap', 'Look', 'Mirror gap (px)', 0, 12, 1, 0),
  range('reflectionBlur', 'Look', 'Reflection blur', 0, 1, 0.05, 0),
  range('tilt', 'Look', 'Tilt (deg)', -12, 12, 0.5, 0),
  select('backdrop', 'Look', 'Backdrop', ['none', 'ice', 'black', 'ice2'], 'none'),
];

export const MIRROR_GROUPS = [...new Set(MIRROR_SCHEMA.map((s) => s.group))];

const FIELD = new Map(MIRROR_SCHEMA.map((s) => [s.key, s]));

export function defaultMirror() {
  return Object.fromEntries(MIRROR_SCHEMA.map((s) => [s.key, s.def]));
}

const repair = (spec, v) => {
  const r = repairField(spec, v);
  return spec.floor && r > 0 && r < spec.floor ? spec.floor : r;
};

export function migrateHeight(mult) {
  if (!Number.isFinite(mult) || mult === 1) return 0;
  return Math.min(600, Math.max(20, Math.round((mult * MIGRATE_REF_HALF * HEIGHT_MAX) / 5) * 5));
}

export function migrateBars(density, width) {
  const d = Number.isFinite(density) && density > 0 ? density : 1;
  const wf = Number.isFinite(width) && width > 0 ? width : BAR_WIDTH_FRACTION;
  if (d === 1 && wf === BAR_WIDTH_FRACTION) return { barWidth: 0, gap: 2 };
  const pitch = MIGRATE_REF_WIDTH / barCount(MIGRATE_REF_WIDTH, d);
  const barWidth = Math.min(40, Math.max(2, Math.round(pitch * wf)));
  const gap = Math.min(20, Math.max(0, Math.round(pitch - barWidth)));
  return { barWidth, gap };
}

export function validateMirror(raw) {
  let src = raw;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return defaultMirror(); }
  }
  const out = defaultMirror();
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  if (src.v !== undefined && src.v !== MIRROR_VERSION) return out;
  const legacy = !('barWidth' in src) && ('density' in src || 'width' in src);
  const old = legacy ? migrateBars(Number(src.density), Number(src.width)) : null;
  for (const s of MIRROR_SCHEMA) if (s.key in src) out[s.key] = repair(s, src[s.key]);
  if (old) Object.assign(out, old);
  if (!('maxHeight' in src) && 'height' in src) out.maxHeight = migrateHeight(Number(src.height));
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
  const v = repair(spec, value);
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
  if ((gradient === 'ice' || gradient === 'ice-reversed') && !colors.ice) return colors;
  if (gradient === 'ice2' && !colors.ice2) return colors;
  const hit = colorCache.get(colors);
  if (hit?.gradient === gradient) return hit.value;
  let stops;
  if (gradient === 'reversed') stops = [...colors.stops].reverse();
  else if (gradient === 'ice') stops = colors.ice.stops;
  else if (gradient === 'ice-reversed') stops = [...colors.ice.stops].reverse();
  else if (gradient === 'ice2') stops = [...colors.ice2.stops].reverse();
  else stops = colors.stops.map(() => colors.accent);
  const value = { ...colors, stops, a: stops[0], b: stops.at(-1) };
  if (gradient === 'ice') value.line = stops.at(-1);
  else if (gradient === 'ice2') value.line = stops[0];
  else if (gradient === 'ice-reversed') value.line = colors.ice.stops.at(-1);
  colorCache.set(colors, { gradient, value });
  return value;
}

export function resetMirrorForTests() {
  current = null;
  version = 0;
  listeners.clear();
}
