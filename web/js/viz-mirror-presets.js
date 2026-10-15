import { defaultMirror, validateMirror } from './viz-mirror-settings.js';

const build = (id, name, over) => ({ id, name, settings: validateMirror({ ...defaultMirror(), ...over }) });

export const MIRROR_PRESET_LIST = [
  build('neon-cylinders', 'Neon Cylinders', { density: 0.5, width: 0.8, height: 1, rise: 0.7, fall: 0.12, gradient: 'theme', reflection: 0.15, horizon: true }),
  build('cyan-magenta-wave', 'Cyan Magenta Wave', { density: 1.6, width: 0.4, height: 1, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.5, horizon: true }),
  build('neon-blocks', 'Neon Blocks', { density: 0.8, width: 0.8, height: 0.9, rise: 0.8, fall: 0.2, gradient: 'theme', reflection: 0.6, horizon: true }),
  build('pink-cyan-blocks', 'Pink Cyan Blocks', { density: 0.5, width: 0.85, height: 0.9, rise: 0.6, fall: 0.15, gradient: 'reversed', reflection: 0.25, horizon: false }),
  build('ice-blue-mirror', 'Ice Blue Mirror', { density: 1.2, width: 0.9, height: 1.1, rise: 0.6, fall: 0.15, gradient: 'accent', reflection: 0.8, horizon: true }),
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
