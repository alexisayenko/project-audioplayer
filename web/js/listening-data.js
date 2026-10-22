import { getListening as getSongs, refreshListening as refreshSongs } from './listening-stats.js';

const wrap = (songs) => ({ songs });

export function getListening() {
  return getSongs().then(wrap, () => null);
}

export function refreshListening() {
  return refreshSongs().then(wrap, () => null);
}
