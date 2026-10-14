import { storeGet, storeSet } from './storage.js';

export const STYLE_STORAGE_KEY = 'ap2.viz.terrain.style';
export const DEFAULT_STYLE = 'relief';
export const TERRAIN_STYLES = [
  { id: 'relief', label: 'Relief' },
  { id: 'single', label: 'Beat peaks: single' },
  { id: 'hill', label: 'Beat peaks: hill' },
  { id: 'multi', label: 'Beat peaks: multi' },
  { id: 'full', label: 'Beat peaks: full spectrum' },
  { id: 'melody', label: 'Melody on beats' },
];

export const normaliseStyle = (v) => (TERRAIN_STYLES.some((s) => s.id === v) ? v : DEFAULT_STYLE);
export const styleLabel = (id) => TERRAIN_STYLES.find((s) => s.id === id)?.label ?? TERRAIN_STYLES[0].label;
export const isMelodyStyle = (id) => id === 'melody';
export const isBeatStyle = (id) => id === 'single' || id === 'hill' || id === 'multi' || id === 'full';

export function nextStyle(id) {
  const i = TERRAIN_STYLES.findIndex((s) => s.id === id);
  return TERRAIN_STYLES[(i + 1) % TERRAIN_STYLES.length].id;
}

const listeners = new Set();
let current = null;

export function getStyle() {
  current ??= normaliseStyle(storeGet(STYLE_STORAGE_KEY));
  return current;
}

export function setStyle(id) {
  current = normaliseStyle(id);
  storeSet(STYLE_STORAGE_KEY, current);
  for (const cb of listeners) cb(current);
  return current;
}

export function onStyle(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resetStyleForTests() {
  current = null;
}
