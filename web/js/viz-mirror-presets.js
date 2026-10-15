import { defaultMirror, validateMirror } from './viz-mirror-settings.js';

const build = (id, name, over) => ({ id, name, settings: validateMirror({ ...defaultMirror(), ...over }) });

export const MIRROR_PRESET_LIST = [
  build('neon-cylinders', 'Neon Cylinders', { barWidth: 6, gap: 2, rise: 0.7, fall: 0.12, gradient: 'theme', reflection: 0.15, horizon: true }),
  build('cyan-magenta-wave', 'Cyan Magenta Wave', { barWidth: 2, gap: 1, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.5, horizon: true }),
  build('neon-blocks', 'Neon Blocks', { barWidth: 4, gap: 1, maxHeight: 145, rise: 0.8, fall: 0.2, gradient: 'theme', reflection: 0.6, horizon: true }),
  build('pink-cyan-blocks', 'Pink Cyan Blocks', { barWidth: 7, gap: 1, maxHeight: 145, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.25, horizon: false }),
  build('ice-blue-mirror', 'Ice Blue Mirror', {
    barWidth: 10, gap: 2, maxHeight: 175, segments: 20, segmentGap: 0.3, rise: 0.6, fall: 0.15, gradient: 'ice', direction: 'vertical', reflection: 0.8, horizon: true, band: 0.6, backdrop: 'ice',
  }),
  build('classic', 'Classic', {}),
];

const BY_ID = new Map(MIRROR_PRESET_LIST.map((p) => [p.id, p]));

export const MIRROR_PRESET_THUMB = (id) => `img/mirror-presets/${id}.png`;

export function applyMirrorPreset(id) {
  const p = BY_ID.get(id);
  return p ? { ...p.settings } : null;
}

export function findActiveMirrorPreset(settings) {
  if (!settings || typeof settings !== 'object') return null;
  for (const p of MIRROR_PRESET_LIST) {
    if (Object.keys(p.settings).every((k) => p.settings[k] === settings[k])) return p.id;
  }
  return null;
}
