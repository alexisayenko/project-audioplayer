import { storeGet, storeSet } from './storage.js';
import { FADE_IN_KEY, FADE_OUT_KEY, normalizePercent } from './fade.js';

const listeners = new Set();

export const fadeSettings = {
  fadeIn: () => normalizePercent(storeGet(FADE_IN_KEY)),
  fadeOut: () => normalizePercent(storeGet(FADE_OUT_KEY)),
  setFadeIn(v) { storeSet(FADE_IN_KEY, String(normalizePercent(v))); listeners.forEach((fn) => fn()); },
  setFadeOut(v) { storeSet(FADE_OUT_KEY, String(normalizePercent(v))); listeners.forEach((fn) => fn()); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
