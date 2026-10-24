import { isSignedIn } from './api.js';
import { isGuest } from './guest.js';
import { outlineDefaultOpen } from './genre-view.js';
import { createLayoutStore } from './genre-layout-store.js';
import { loadDrill } from './genre-drill.js';
import { loadSelected } from './genres-rework-storage.js';

export const optionString = (value) => (typeof value === 'string' ? value : null);

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const initialOutlineOpen = (v2) => v2 || outlineDefaultOpen(window.innerWidth || 1200);

export function initialDrill(v2, storage) {
  if (v2) return false;
  return loadDrill(storage);
}

export function initialSelected(v2, storage) {
  if (!v2) return null;
  return loadSelected(storage);
}

export function makeLayoutStore(v2) {
  return v2 && !isGuest() && isSignedIn() ? createLayoutStore() : null;
}

export function wrapClass(opts, v2) {
  return ['gm gmr', opts?.dock === true ? 'has-dock' : '', v2 ? 'gm-v2' : ''].filter(Boolean).join(' ');
}
