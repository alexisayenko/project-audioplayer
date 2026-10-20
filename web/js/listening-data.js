import { getListening as getSongs, invalidateListening } from './listening-stats.js';

const wrap = (songs) => ({ songs });

export function getListening() {
  return getSongs().then(wrap, () => null);
}

export function refreshListening() {
  invalidateListening();
  return getListening();
}
