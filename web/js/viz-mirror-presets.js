import { defaultMirror, validateMirror } from './viz-mirror-settings.js';

const build = (id, name, over) => ({ id, name, settings: validateMirror({ ...defaultMirror(), ...over }) });

// FROZEN: the liked look (tag mirror-liked-1). Never edit; change ICE_BLUE_2 instead.
const ICE_BLUE = {
  barWidth: 10, gap: 2, maxHeight: 175, segments: 20, segmentGap: 0.3, rise: 0.6, fall: 0.15, gradient: 'ice', direction: 'vertical', reflection: 0.8, horizon: true, band: 0.6, backdrop: 'ice',
};
// Working copy: starts identical to ICE_BLUE, edit freely.
const ICE_BLUE_2 = {
  ...ICE_BLUE, barWidth: 40, gap: 6, maxHeight: 280, segments: 21, sectionHeight: 0, segmentGap: 0.2, gradient: 'ice2', horizon: false, band: 0, backdrop: 'ice2', reflection: 0.5,
  sectorMode: 'trail', peak: 0, peakHold: 0.6, afterimage: 0, afterTau: 0.35, shadeJitter: 0.06, baseGlow: 0.8, mirrorGap: 8, reflectionBlur: 0.4, tilt: 0, glow: 0.8, glowSize: 1,
};

export const MIRROR_PRESET_LIST = [
  build('neon-cylinders', 'Neon Cylinders', { barWidth: 6, gap: 2, rise: 0.7, fall: 0.12, gradient: 'theme', reflection: 0.15, horizon: true }),
  build('cyan-magenta-wave', 'Cyan Magenta Wave', { barWidth: 2, gap: 1, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.5, horizon: true }),
  build('neon-blocks', 'Neon Blocks', { barWidth: 4, gap: 1, maxHeight: 145, rise: 0.8, fall: 0.2, gradient: 'theme', reflection: 0.6, horizon: true }),
  build('pink-cyan-blocks', 'Pink Cyan Blocks', { barWidth: 7, gap: 1, maxHeight: 145, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.25, horizon: false }),
  build('ice-blue-mirror', 'Ice Blue Mirror', ICE_BLUE),
  build('ice-blue-mirror-2', 'Ice Blue Mirror 2', ICE_BLUE_2),
  build('classic', 'Classic', {}),
];

const BY_ID = new Map(MIRROR_PRESET_LIST.map((p) => [p.id, p]));

export const MIRROR_PRESET_THUMB = (id) => `img/mirror-presets/${id}.png`;

export function applyMirrorPreset(id) {
  const p = BY_ID.get(id);
  return p ? { ...p.settings } : null;
}

export const MIRROR_PRESET_KEY = 'ap2.viz.mirror.preset';

export function getLastMirrorPreset() {
  try { return localStorage.getItem(MIRROR_PRESET_KEY); } catch { return null; }
}

export function setLastMirrorPreset(id) {
  try { localStorage.setItem(MIRROR_PRESET_KEY, id); } catch { /* storage unavailable */ }
}

const matches = (p, settings) => Object.keys(p.settings).every((k) => p.settings[k] === settings[k]);

export function pickActivePreset(list, settings, preferredId) {
  if (!settings || typeof settings !== 'object') return null;
  const pref = preferredId && list.find((p) => p.id === preferredId);
  if (pref && matches(pref, settings)) return pref.id;
  return list.find((p) => matches(p, settings))?.id ?? null;
}

export function findActiveMirrorPreset(settings, preferredId = getLastMirrorPreset()) {
  return pickActivePreset(MIRROR_PRESET_LIST, settings, preferredId);
}
