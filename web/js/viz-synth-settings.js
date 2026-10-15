import { storeGet, storeSet } from './storage.js';

export const SYNTH_KEY = 'ap2.viz.synth';
export const SYNTH_VERSION = 1;

const HEX = /^#[0-9a-f]{6}$/i;
const PRESET_IDS = ['custom', 'cyan', 'pink', 'blue', 'magenta'];

const f = (path, group, label, type, def, o = {}) => ({ path, group, label, type, def, ...o });
const range = (path, group, label, min, max, step, def) => f(path, group, label, 'range', def, { min, max, step });
const int = (path, group, label, min, max, def) => f(path, group, label, 'int', def, { min, max, step: 1 });
const select = (path, group, label, options, def) => f(path, group, label, 'select', def, { options });
const bool = (path, group, label, def) => f(path, group, label, 'bool', def);
const color = (path, group, label, def) => f(path, group, label, 'color', def);

export const SYNTH_SCHEMA = [
  select('terrain.preset', 'Terrain', 'Colour preset', PRESET_IDS, 'cyan'),
  select('terrain.grid', 'Terrain', 'Grid', ['square', 'triangle'], 'square'),
  range('terrain.speed', 'Terrain', 'Speed', 0.2, 2, 0.05, 1),
  range('terrain.cell', 'Terrain', 'Cell size', 0.2, 1.2, 0.05, 0.6),
  color('terrain.lineColor', 'Terrain', 'Line colour', '#2ee6ff'),
  color('terrain.fillColor', 'Terrain', 'Fill colour', '#12062b'),
  color('terrain.faceColor', 'Terrain', 'Face colour', '#0b3a4a'),
  range('terrain.lineWidth', 'Terrain', 'Line width', 0.5, 3, 0.1, 1.2),
  range('terrain.glow', 'Terrain', 'Line glow', 0, 1, 0.05, 0.6),
  select('terrain.fill', 'Terrain', 'Fill', ['none', 'dark', 'faces'], 'dark'),
  range('terrain.eye', 'Terrain', 'Camera height', 1, 6, 0.1, 2.6),
  bool('terrain.hills', 'Terrain', 'Horizon hills', false),
  color('terrain.hillsColor', 'Terrain', 'Hills colour', '#0a0220'),
  range('terrain.sharp', 'Peaks', 'Sharpness', 0, 1, 0.05, 0.45),
  range('terrain.height', 'Peaks', 'Peak height', 0.2, 2, 0.05, 1),
  range('terrain.density', 'Peaks', 'Detail', 0, 1, 0.05, 0.5),
  select('terrain.render', 'Peaks', 'Peak style', ['wire', 'filled', 'both'], 'both'),
  range('terrain.edgeGlow', 'Peaks', 'Edge glow', 0, 1, 0.05, 0.7),
  range('terrain.fade', 'Peaks', 'Fade speed', 0.2, 3, 0.05, 1),
  bool('terrain.valley', 'Peaks', 'Valley', true),
  range('terrain.valleyWidth', 'Peaks', 'Valley width', 0.05, 0.5, 0.01, 0.18),
  bool('terrain.future', 'Peaks', 'Future silhouette', true),
  range('terrain.futureOpacity', 'Peaks', 'Future opacity', 0, 1, 0.05, 0.25),
  range('terrain.futureDist', 'Peaks', 'Future distance', 0.1, 1, 0.05, 0.6),
  select('terrain.futureStyle', 'Peaks', 'Future style', ['line', 'fill'], 'line'),

  bool('sun.on', 'Sun', 'Sun', true),
  range('sun.radius', 'Sun', 'Radius', 0.05, 0.6, 0.01, 0.22),
  range('sun.height', 'Sun', 'Sun height (radii)', -1, 3, 0.05, 0.5),
  color('sun.top', 'Sun', 'Top colour', '#ffd23f'),
  color('sun.bottom', 'Sun', 'Bottom colour', '#ff2d95'),
  color('sun.mid', 'Sun', 'Middle colour', '#ff7a3d'),
  bool('sun.midOn', 'Sun', 'Middle colour on', true),
  range('sun.sliceStart', 'Sun', 'Slices start', 0, 0.9, 0.05, 0.5),
  int('sun.sliceCount', 'Sun', 'Slice count', 0, 16, 7),
  range('sun.sliceFirst', 'Sun', 'First slice', 0.005, 0.1, 0.005, 0.025),
  range('sun.sliceGrowth', 'Sun', 'Slice growth', 1, 2.5, 0.05, 1.45),
  select('sun.sliceEdge', 'Sun', 'Slice edge', ['smooth', 'stepped'], 'smooth'),
  range('sun.sliceDrift', 'Sun', 'Slice drift', 0, 1, 0.05, 0.2),

  bool('sun.ringOn', 'Haze', 'Haze', true),
  select('sun.ringShape', 'Haze', 'Haze shape', ['ring', 'band'], 'ring'),
  color('sun.ringColor', 'Haze', 'Haze colour', '#ff5a3c'),
  range('sun.ringRadius', 'Haze', 'Haze radius', 1, 2.5, 0.05, 1.5),
  range('sun.ringSoft', 'Haze', 'Haze softness', 0, 1, 0.05, 0.7),
  range('sun.ringAlpha', 'Haze', 'Haze opacity', 0, 1, 0.05, 0.55),
  bool('sun.bandOn', 'Haze', 'Horizon band', true),
  color('sun.bandColor', 'Haze', 'Band colour', '#ff3d8a'),
  range('sun.bandHeight', 'Haze', 'Band height', 0, 0.2, 0.005, 0.06),
  range('sun.hazeMove', 'Haze', 'Haze movement', 0, 1, 0.05, 0.4),

  select('sun.refl', 'Reflection', 'Reflection', ['streak', 'blur', 'off'], 'streak'),
  bool('sun.reflFollow', 'Reflection', 'Follow sun colours', true),
  color('sun.reflColor', 'Reflection', 'Reflection colour', '#ff5aa5'),
  range('sun.reflOpacity', 'Reflection', 'Opacity', 0, 1, 0.05, 0.5),
  range('sun.reflLength', 'Reflection', 'Length', 0.1, 1, 0.05, 0.5),
  range('sun.reflFade', 'Reflection', 'Fade', 0, 1, 0.05, 0.7),
  range('sun.reflRipple', 'Reflection', 'Ripple', 0, 1, 0.05, 0.3),
  bool('sun.sheen', 'Reflection', 'Wet sheen', true),
  range('sun.sheenAmount', 'Reflection', 'Sheen amount', 0, 1, 0.05, 0.35),

  range('sky.horizonV', 'Horizon', 'Horizon position', 0.25, 0.6, 0.01, 0.4),
  color('sky.hColor', 'Horizon', 'Line colour', '#ff4fd8'),
  range('sky.hThick', 'Horizon', 'Line thickness', 0.5, 6, 0.1, 1.5),
  range('sky.hGlow', 'Horizon', 'Line glow', 0, 1, 0.05, 0.7),
  range('sky.hSpread', 'Horizon', 'Glow spread', 0, 0.15, 0.005, 0.04),
  range('sky.hSoft', 'Horizon', 'Softness', 0, 1, 0.05, 0.3),
  bool('sky.hBand', 'Horizon', 'Colour band', false),
  color('sky.hBandColor', 'Horizon', 'Band colour', '#3b6bff'),
  range('sky.hBandHeight', 'Horizon', 'Band height', 0, 0.1, 0.005, 0.02),

  color('sky.top', 'Sky', 'Top colour', '#05021a'),
  color('sky.mid', 'Sky', 'Middle colour', '#1a0a4a'),
  color('sky.bottom', 'Sky', 'Bottom colour', '#5a1a7a'),
  bool('sky.midOn', 'Sky', 'Middle colour on', true),
  int('sky.stars', 'Sky', 'Stars', 0, 600, 140),
  range('sky.starSize', 'Sky', 'Star size', 0.5, 3, 0.1, 1.2),
  range('sky.starBright', 'Sky', 'Star brightness', 0, 1, 0.05, 0.7),
  range('sky.twinkle', 'Sky', 'Twinkle', 0, 1, 0.05, 0.4),
  int('sky.starSeed', 'Sky', 'Star pattern', 0, 9999, 7),
  bool('sky.vignette', 'Sky', 'Vignette', true),
  range('sky.vignetteAmount', 'Sky', 'Vignette amount', 0, 1, 0.05, 0.45),
];

export const SYNTH_GROUPS = [...new Set(SYNTH_SCHEMA.map((s) => s.group))];

export const SYNTH_PRESETS = {
  cyan: { lineColor: '#2ee6ff', fillColor: '#12062b', faceColor: '#0b3a4a', hColor: '#ff4fd8' },
  pink: { lineColor: '#ff4fb8', fillColor: '#14041a', faceColor: '#4a0b3a', hColor: '#ff4fb8' },
  blue: { lineColor: '#3d7bff', fillColor: '#dfe9ff', faceColor: '#9db8ff', hColor: '#3d7bff' },
  magenta: { lineColor: '#ff2bd6', fillColor: '#050008', faceColor: '#2a0030', hColor: '#ff2bd6' },
};

const PRESET_COLOR_GROUP = { lineColor: 'terrain', fillColor: 'terrain', faceColor: 'terrain', hColor: 'sky' };
const FIELD = new Map(SYNTH_SCHEMA.map((s) => [s.path, s]));

const split = (path) => { const i = path.indexOf('.'); return [path.slice(0, i), path.slice(i + 1)]; };

export function parseHex(str) {
  if (typeof str !== 'string' || !HEX.test(str)) return [0, 0, 0];
  const n = parseInt(str.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function repairField(spec, v) {
  switch (spec.type) {
    case 'range': {
      const n = typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.def;
    }
    case 'int': {
      const n = typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : spec.def;
    }
    case 'select': return spec.options.includes(v) ? v : spec.def;
    case 'bool': return typeof v === 'boolean' ? v : spec.def;
    case 'color': return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : spec.def;
    default: return spec.def;
  }
}

export function defaultSynth() {
  const out = { terrain: {}, sun: {}, sky: {} };
  for (const s of SYNTH_SCHEMA) { const [g, k] = split(s.path); out[g][k] = s.def; }
  return out;
}

export function validateSynth(raw) {
  let src = raw;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return defaultSynth(); }
  }
  const out = defaultSynth();
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  if (src.v !== undefined && src.v !== SYNTH_VERSION) return out;
  for (const s of SYNTH_SCHEMA) {
    const [g, k] = split(s.path);
    const grp = src[g];
    if (grp && typeof grp === 'object' && k in grp) out[g][k] = repairField(s, grp[k]);
  }
  return out;
}

const listeners = new Set();
let current = null;
let version = 0;

const persist = () => { storeSet(SYNTH_KEY, JSON.stringify({ v: SYNTH_VERSION, ...current })); };

function commit(next, path) {
  current = next;
  version += 1;
  persist();
  for (const cb of [...listeners]) cb(current, path);
}

function withValue(cur, path, value) {
  const [g, k] = split(path);
  return { ...cur, [g]: { ...cur[g], [k]: value } };
}

export function getSynth() {
  current ??= validateSynth(storeGet(SYNTH_KEY));
  return current;
}

export const synthVersion = () => version;

export function applyPreset(id) {
  if (!PRESET_IDS.includes(id)) return false;
  const cur = getSynth();
  let next = cur;
  if (cur.terrain.preset !== id) next = withValue(next, 'terrain.preset', id);
  const p = SYNTH_PRESETS[id];
  if (p) {
    for (const [k, g] of Object.entries(PRESET_COLOR_GROUP)) {
      if (next[g][k] !== p[k]) next = withValue(next, `${g}.${k}`, p[k]);
    }
  }
  if (next !== cur) commit(next, 'terrain.preset');
  return true;
}

export function setSynth(path, value) {
  const spec = FIELD.get(path);
  if (!spec) return undefined;
  const v = repairField(spec, value);
  if (path === 'terrain.preset') {
    applyPreset(v);
    return v;
  }
  const cur = getSynth();
  const [g, k] = split(path);
  if (cur[g][k] === v) return v;
  let next = withValue(cur, path, v);
  if (PRESET_COLOR_GROUP[k] === g && next.terrain.preset !== 'custom') next = withValue(next, 'terrain.preset', 'custom');
  commit(next, path);
  return v;
}

export function replaceSynth(raw) {
  const next = validateSynth(raw);
  commit(next, '*');
  return next;
}

export function resetSynth(group) {
  const cur = getSynth();
  const def = defaultSynth();
  const out = { terrain: { ...cur.terrain }, sun: { ...cur.sun }, sky: { ...cur.sky } };
  let changed = false;
  for (const s of SYNTH_SCHEMA) {
    if (group && s.group !== group) continue;
    const [g, k] = split(s.path);
    if (out[g][k] !== def[g][k]) { out[g][k] = def[g][k]; changed = true; }
  }
  if (changed) commit(out, group ?? '*');
  return getSynth();
}

export function onSynth(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resetSynthForTests() {
  current = null;
  version = 0;
  listeners.clear();
}
