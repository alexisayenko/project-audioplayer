import { storeGet, storeSet } from './storage.js';
import { HEIGHT_STORAGE_KEY, HEIGHT_OPTIONS, DEFAULT_HEIGHT } from './viz-constants.js';
import { PARTS_STORAGE_KEY, validateParts } from './viz-parts.js';
import { MODES, DEFAULT_MODE, MODE_STORAGE_KEY, LEGACY_MODES, detectCaps, pickMode } from './viz-modes.js';

const modeListeners = new Set();
const heightListeners = new Set();
const partsListeners = new Set();
let caps = null;

export function vizCaps(doc = globalThis.document) {
  caps ??= detectCaps(doc);
  return caps;
}

export function resetVizCapsForTests(next = null) {
  caps = next;
}

export function vizMode(getCaps = vizCaps) {
  const saved = storeGet(MODE_STORAGE_KEY);
  const id = LEGACY_MODES[saved] ?? saved;
  return pickMode(id, MODES.find((m) => m.id === id)?.requiresWebGL ? getCaps() : { webgl: false });
}

export function setVizMode(id) {
  const next = MODES.some((m) => m.id === id) ? id : DEFAULT_MODE;
  storeSet(MODE_STORAGE_KEY, next);
  for (const cb of modeListeners) cb(next);
}

export function onVizMode(cb) {
  modeListeners.add(cb);
  return () => modeListeners.delete(cb);
}

export function vizHeightId() {
  const saved = storeGet(HEIGHT_STORAGE_KEY);
  return HEIGHT_OPTIONS.some((o) => o.id === saved) ? saved : DEFAULT_HEIGHT;
}

export const vizHeightScale = () => HEIGHT_OPTIONS.find((o) => o.id === vizHeightId()).scale;

export function setVizHeight(id) {
  const next = HEIGHT_OPTIONS.some((o) => o.id === id) ? id : DEFAULT_HEIGHT;
  storeSet(HEIGHT_STORAGE_KEY, next);
  for (const cb of heightListeners) cb(vizHeightScale());
}

export function onVizHeight(cb) {
  heightListeners.add(cb);
  return () => heightListeners.delete(cb);
}

export const vizParts = () => validateParts(storeGet(PARTS_STORAGE_KEY));

export function setVizParts(state) {
  const next = validateParts(state);
  storeSet(PARTS_STORAGE_KEY, JSON.stringify(next));
  for (const cb of partsListeners) cb(next);
}

export function onVizParts(cb) {
  partsListeners.add(cb);
  return () => partsListeners.delete(cb);
}
