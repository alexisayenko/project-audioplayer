import { createTerrain as defaultCreateTerrain, isWebGLAvailable } from './viz-terrain-gl.js';

export const MODES = [
  { id: 'bars', label: 'Mirrored spectrum', icon: 'equalizer', requiresWebGL: false },
  { id: 'ring', label: 'Ring', icon: 'ring', requiresWebGL: false },
  { id: 'terrain', label: 'Terrain', icon: 'terrain', requiresWebGL: true },
  { id: 'synthwave', label: 'Synthwave terrain', icon: 'synthwave', requiresWebGL: true },
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

export const isSceneMode = (id) => id === 'terrain' || id === 'synthwave';
export const usesFlight = (id) => id === 'terrain';

const GOV_TO_TERRAIN = [2, 1, 1, 0];
const govToTerrain = (g) => GOV_TO_TERRAIN[Math.min(GOV_TO_TERRAIN.length - 1, Math.max(0, Math.trunc(g) || 0))];

export function createModeRenderer(id, canvas2d, canvasGL, deps = {}) {
  const factories = { terrain: deps.createTerrain || defaultCreateTerrain, ...deps.factories };
  const draw2d = deps.draw2d || (() => {});
  const want = MODES.find((m) => m.id === pickMode(id, { webgl: true })) || MODES[0];
  let terrain = null;
  if (want.requiresWebGL && canvasGL) terrain = factories[want.id]?.(canvasGL, deps.terrainOpts || {}) ?? null;
  const effective = want.requiresWebGL && !terrain ? DEFAULT_MODE : want.id;
  const showGL = !!terrain;
  const showBars = !showGL;
  if (canvas2d) canvas2d.hidden = !showBars;
  if (canvasGL) canvasGL.hidden = !showGL;
  return {
    id: effective,
    usesGL: showGL,
    draw(spectrum, t, look, latS = 0) {
      if (showGL) terrain.draw(spectrum, t, look, latS);
      if (showBars) draw2d(spectrum, t);
    },
    resize(w, h, dpr) {
      terrain?.resize(w, h, dpr);
    },
    setQuality(governorLevel, o = {}) {
      if (!terrain) return;
      const forced = Number.isInteger(o.force) ? o.force : null;
      terrain.setQuality(forced ?? Math.min(govToTerrain(governorLevel), Number.isInteger(o.cap) ? o.cap : 2));
      terrain.setLite?.(forced === null && !!o.lite);
      terrain.setDprCap?.(forced === null && !!o.hiDpr);
      terrain.setShed?.(forced === null && Number.isInteger(o.shed) ? o.shed : 0);
    },
    get stats() { return terrain?.stats ?? null; },
    dispose() {
      terrain?.dispose();
      terrain = null;
    },
  };
}
