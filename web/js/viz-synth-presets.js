import { defaultSynth, validateSynth } from './viz-synth-settings.js';

const GROUPS = ['terrain', 'sun', 'sky'];

const build = (id, name, over) => {
  const base = defaultSynth();
  const merged = {};
  for (const g of GROUPS) merged[g] = { ...base[g], ...over[g] };
  merged.terrain.preset = 'custom';
  return { id, name, settings: validateSynth(merged) };
};

const FLAT = { height: 0.2, sharp: 0, density: 0, valley: true, valleyWidth: 0.5, future: false };

export const SYNTH_PRESET_LIST = [
  build('blue-valley', 'Blue valley', {
    terrain: {
      grid: 'triangle', cell: 0.55, lineColor: '#dce8ff', lineWidth: 1, glow: 0.5, fill: 'faces', faceColor: '#5f86dc',
      render: 'both', edgeGlow: 1, sharp: 0.95, height: 1.4, density: 0.7, valley: true, valleyWidth: 0.2, future: false, hills: false, eye: 2.4,
    },
    sun: {
      radius: 0.3, height: 0.3, top: '#fff0a8', mid: '#ffe08a', midOn: false, bottom: '#ffd36b',
      sliceStart: 0.5, sliceCount: 8, sliceGrowth: 1.5, sliceEdge: 'smooth',
      ringOn: true, ringShape: 'ring', ringColor: '#ff4a2a', ringRadius: 2, ringSoft: 0.9, ringAlpha: 0.9,
      bandOn: true, bandColor: '#ff5a3a', bandHeight: 0.1, refl: 'off',
    },
    sky: {
      top: '#0d0420', mid: '#1c0a3a', bottom: '#3a1458', midOn: true, stars: 360, starSize: 1.4, starBright: 0.9, twinkle: 0.5, starSeed: 11,
      hColor: '#ff7a5a', hThick: 1.5, hGlow: 0.8, hBand: false, vignette: true, vignetteAmount: 0.4,
    },
  }),
  build('teal-dunes', 'Teal dunes', {
    terrain: {
      grid: 'square', cell: 0.25, lineColor: '#16b8a8', lineWidth: 0.6, glow: 0.35, fill: 'dark', fillColor: '#03070a',
      render: 'wire', sharp: 0, height: 0.9, density: 0.35, valley: false, future: false, hills: false, eye: 2.2,
    },
    sun: {
      radius: 0.5, height: 0.15, top: '#ffd23f', mid: '#ff7a2a', midOn: true, bottom: '#ff2d95',
      sliceCount: 0, ringOn: true, ringShape: 'ring', ringColor: '#ff9a6a', ringRadius: 1.4, ringSoft: 1, ringAlpha: 0.2,
      bandOn: true, bandColor: '#ff4fa0', bandHeight: 0.12, refl: 'off',
    },
    sky: {
      top: '#1a0c10', mid: '#4a1a40', bottom: '#d04a90', midOn: true, stars: 20, starSize: 0.7, starBright: 0.6, twinkle: 0.3, starSeed: 23,
      hColor: '#ff6ab0', hThick: 1, hGlow: 0.5, hSoft: 0.7, hBand: false, vignette: true, vignetteAmount: 0.3,
    },
  }),
  build('neon-peaks', 'Neon peaks', {
    terrain: {
      grid: 'square', cell: 0.5, lineColor: '#2ef2ff', lineWidth: 2.4, glow: 1, fill: 'faces', faceColor: '#1a0a4a',
      render: 'both', edgeGlow: 1, sharp: 1, height: 1.6, density: 0.5, valley: true, valleyWidth: 0.2, future: false, hills: false, eye: 2.8,
    },
    sun: {
      radius: 0.26, height: 0.4, top: '#ffe83a', mid: '#ffb03a', midOn: false, bottom: '#ff4fb0',
      sliceStart: 0.6, sliceCount: 4, sliceGrowth: 1.5,
      ringOn: true, ringShape: 'ring', ringColor: '#ff3ad0', ringRadius: 1.3, ringSoft: 0.8, ringAlpha: 0.25,
      bandOn: false, refl: 'blur', reflFollow: false, reflColor: '#ffe84a', reflOpacity: 0.7, reflLength: 0.5, reflFade: 0.6, reflRipple: 0.5,
      sheen: true, sheenAmount: 0.5,
    },
    sky: {
      top: '#2a0a6a', mid: '#6a1a9a', bottom: '#d02ab0', midOn: true, stars: 120, starSize: 1.2, starBright: 0.8, twinkle: 0.4, starSeed: 5,
      hColor: '#ff2bd6', hThick: 2, hGlow: 0.9, hBand: false, vignette: true, vignetteAmount: 0.4,
    },
  }),
  build('violet-plain', 'Violet plain', {
    terrain: {
      grid: 'square', cell: 0.6, lineColor: '#8a5aff', lineWidth: 0.8, glow: 0.5, fill: 'dark', fillColor: '#2a0a5a',
      render: 'wire', edgeGlow: 0.7, sharp: 0.6, height: 0.5, density: 0.5, valley: false, future: false, hills: false, eye: 2.4,
    },
    sun: {
      radius: 0.3, height: 0.9, top: '#ffd23f', mid: '#ff6a2a', midOn: true, bottom: '#e0102a',
      sliceStart: 0.5, sliceCount: 7, sliceGrowth: 1.4,
      ringOn: true, ringShape: 'ring', ringColor: '#8a0a1a', ringRadius: 1.9, ringSoft: 0.2, ringAlpha: 0.85,
      bandOn: false, refl: 'blur', reflFollow: false, reflColor: '#4ad0b0', reflOpacity: 0.55, reflLength: 0.75, reflFade: 0.5, reflRipple: 0.6,
      sheen: true, sheenAmount: 0.5,
    },
    sky: {
      top: '#020006', mid: '#05010a', bottom: '#0a0212', midOn: true, stars: 600, starSize: 0.7, starBright: 0.85, twinkle: 0.4, starSeed: 31,
      hColor: '#6a3aff', hThick: 1, hGlow: 0.5, hBand: false, vignette: true, vignetteAmount: 0.4,
    },
  }),
  build('midnight-grid', 'Midnight grid', {
    terrain: {
      ...FLAT, grid: 'square', cell: 0.6, lineColor: '#b89aff', lineWidth: 0.7, glow: 0.3, fill: 'dark', fillColor: '#000000',
      render: 'wire', hills: false, eye: 2.2,
    },
    sun: {
      radius: 0.24, height: 1.35, top: '#ffe03a', mid: '#ff4aa0', midOn: true, bottom: '#3a0a7a',
      sliceStart: 0.5, sliceCount: 7, sliceFirst: 0.02, sliceGrowth: 1.3,
      ringOn: false, bandOn: true, bandColor: '#7a2ad0', bandHeight: 0.1, refl: 'off', sheen: false,
    },
    sky: {
      top: '#000000', mid: '#000000', bottom: '#000000', midOn: false, stars: 60, starSize: 0.9, starBright: 0.7, twinkle: 0.4, starSeed: 3,
      hColor: '#9a4aff', hThick: 1.2, hGlow: 0.9, hSpread: 0.08, hBand: false, vignette: false,
    },
  }),
  build('neon-sea', 'Neon sea', {
    terrain: {
      ...FLAT, grid: 'square', cell: 0.6, lineColor: '#0a0212', lineWidth: 0.5, glow: 0, fill: 'dark', fillColor: '#14062e',
      render: 'wire', hills: false, eye: 2.2,
    },
    sun: {
      radius: 0.3, height: 0, top: '#ffe83a', mid: '#ff6a8a', midOn: true, bottom: '#ff1aa0',
      sliceStart: 0.5, sliceCount: 4, sliceFirst: 0.05, sliceGrowth: 1.6,
      ringOn: true, ringShape: 'ring', ringColor: '#8a2aff', ringRadius: 1.7, ringSoft: 1, ringAlpha: 0.4,
      bandOn: false, refl: 'streak', reflFollow: false, reflColor: '#ff3ad0', reflOpacity: 1, reflLength: 1, reflFade: 1, reflRipple: 0.2,
      sheen: true, sheenAmount: 0.8,
    },
    sky: {
      top: '#1a0a4a', mid: '#2a0a5a', bottom: '#4a0a6a', midOn: true, stars: 90, starSize: 0.7, starBright: 0.6, twinkle: 0.4, starSeed: 17,
      hColor: '#ff2bd6', hThick: 5, hGlow: 1, hSpread: 0.15, hSoft: 0.3, hBand: false, vignette: true, vignetteAmount: 0.35,
    },
  }),
  build('sunset-8bit', '8-bit sunset', {
    terrain: {
      ...FLAT, grid: 'square', cell: 0.5, lineColor: '#2a5aff', lineWidth: 0.8, glow: 0.5, fill: 'dark', fillColor: '#000000',
      render: 'wire', hills: false, eye: 2.2,
    },
    sun: {
      radius: 0.26, height: 0.9, top: '#fff0c8', mid: '#ff9a7a', midOn: true, bottom: '#e0102a',
      sliceStart: 0.3, sliceCount: 8, sliceFirst: 0.02, sliceGrowth: 1.7, sliceEdge: 'stepped',
      ringOn: false, bandOn: true, bandColor: '#ff4a8a', bandHeight: 0.14, refl: 'off', sheen: false,
    },
    sky: {
      top: '#000000', mid: '#000000', bottom: '#000000', midOn: false, stars: 160, starSize: 1.6, starBright: 1, twinkle: 0.5, starSeed: 41,
      hColor: '#2af0ff', hThick: 3, hGlow: 0.8, hSpread: 0.04, hSoft: 0, hBand: true, hBandColor: '#5a0a2a', hBandHeight: 0.06, vignette: false,
    },
  }),
  build('retro-dusk', 'Retro dusk', {
    terrain: {
      ...FLAT, grid: 'square', cell: 0.5, lineColor: '#22d8ff', lineWidth: 0.8, glow: 0.5, fill: 'dark', fillColor: '#000000',
      render: 'wire', hills: false, eye: 2.2,
    },
    sun: {
      radius: 0.24, height: 0.5, top: '#e01020', mid: '#e01020', midOn: false, bottom: '#e01020',
      sliceStart: 0.1, sliceCount: 5, sliceFirst: 0.03, sliceGrowth: 1.5,
      ringOn: false, bandOn: false, refl: 'off', sheen: false,
    },
    sky: {
      top: '#000000', mid: '#2a1a8a', bottom: '#ff3aa0', midOn: true, stars: 0, vignette: false,
      hColor: '#ff3aa0', hThick: 0.5, hGlow: 0.3, hSpread: 0.02, hSoft: 1, hBand: false,
    },
  }),
];

const BY_ID = new Map(SYNTH_PRESET_LIST.map((p) => [p.id, p]));
const clone = (s) => structuredClone(s);

export const PRESET_THUMB = (id) => `img/synth-presets/${id}.png`;

export function applyPreset(id) {
  const p = BY_ID.get(id);
  return p ? clone(p.settings) : null;
}

export function findActivePreset(settings) {
  if (!settings || typeof settings !== 'object') return null;
  for (const g of GROUPS) if (!settings[g] || typeof settings[g] !== 'object') return null;
  for (const p of SYNTH_PRESET_LIST) {
    const same = GROUPS.every((g) => Object.keys(p.settings[g]).every((k) => p.settings[g][k] === settings[g][k]));
    if (same) return p.id;
  }
  return null;
}
