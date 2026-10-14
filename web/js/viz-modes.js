import { createTerrain as defaultCreateTerrain, isWebGLAvailable } from './viz-terrain-gl.js';

export const MODES = [
  { id: 'bars', label: 'Mirrored spectrum', icon: 'equalizer', requiresWebGL: false },
  { id: 'ring', label: 'Ring', icon: 'ring', requiresWebGL: false },
  { id: 'terrain', label: 'Terrain', icon: 'terrain', requiresWebGL: true },
];

export const DEFAULT_MODE = 'bars';
export const MODE_STORAGE_KEY = 'ap2.viz.mode';
export const LEGACY_MODES = { 'bars-ring': 'bars', combo: 'terrain' };

export const detectCaps = (doc) => ({ webgl: isWebGLAvailable(doc) });

export function availableModes(caps) {
  const gl = !!caps?.webgl;
  return MODES.filter((m) => gl || !m.requiresWebGL);
}

export function pickMode(saved, caps) {
  const list = availableModes(caps);
  const id = LEGACY_MODES[saved] ?? saved;
  return list.find((m) => m.id === id)?.id ?? DEFAULT_MODE;
}

export function nextMode(id, caps) {
  const list = availableModes(caps);
  const i = list.findIndex((m) => m.id === id);
  return list[(i + 1) % list.length].id;
}

export const modeLabel = (id) => MODES.find((m) => m.id === id)?.label ?? MODES[0].label;

const govToTerrain = (g) => (g >= 2 ? 0 : 1);

export function createModeRenderer(id, canvas2d, canvasGL, deps = {}) {
  const make = deps.createTerrain || defaultCreateTerrain;
  const draw2d = deps.draw2d || (() => {});
  const want = MODES.find((m) => m.id === pickMode(id, { webgl: true })) || MODES[0];
  let terrain = null;
  if (want.requiresWebGL && canvasGL) terrain = make(canvasGL, deps.terrainOpts || {});
  const effective = want.requiresWebGL && !terrain ? DEFAULT_MODE : want.id;
  const showGL = !!terrain;
  const showBars = !showGL;
  if (canvas2d) canvas2d.hidden = !showBars;
  if (canvasGL) canvasGL.hidden = !showGL;
  return {
    id: effective,
    usesGL: showGL,
    draw(spectrum, t) {
      if (showGL) terrain.draw(spectrum, t);
      if (showBars) draw2d(spectrum, t);
    },
    resize(w, h, dpr) {
      terrain?.resize(w, h, dpr);
    },
    setQuality(governorLevel) {
      terrain?.setQuality(govToTerrain(governorLevel));
    },
    dispose() {
      terrain?.dispose();
      terrain = null;
    },
  };
}
