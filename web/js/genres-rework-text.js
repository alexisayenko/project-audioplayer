import { plural } from './dom.js';
import { hasLevels } from './genre-levels.js';

export const songs = (n) => `${n} ${plural(n, 'song', 'songs')}`;
export const EMPTY_TEXT = 'No genres yet. Add songs with genres to see them here.';
export const canvasLabel = (name) => {
  const of = name ? `${name} ` : '';
  return `Map of ${of}genres. Drag to pan, scroll or pinch to zoom. The outline lists the same genres and is the keyboard alternative.`;
};
export const graphLabel = 'Map of all genres. Drag a circle to pull its neighbours, drag the background to pan, scroll or pinch to zoom, double-click a circle to centre it. The outline lists the same genres and is the keyboard alternative.';
const GROUP_REASON = 'It only organises genres until they get a family of their own.';
export const GROUP_TEXT = (n) => `${n.label} - a ${n.temporary ? 'temporary ' : ''}group: organisational, never assigned to songs. ${n.note || GROUP_REASON}`;
export const groupBadgeText = (n) => (n.temporary ? 'temporary group' : 'group');

export function failureText(v, vocab) {
  if (v.status === 'rejected') return 'Vocabulary unavailable';
  if (!hasLevels(vocab)) return 'Genre levels unavailable: the server has no level data yet';
  return 'Library unavailable: song counts are needed to show genres';
}

export function failureTextV2(v, vocab) {
  if (v.status === 'rejected') return 'Genres structure v2 unavailable';
  if (!vocab) return 'Genres structure v2 is empty: the server has no genres in it yet';
  return 'Library unavailable: song counts are needed to show genres';
}

export function emptyTreeText(filtered, query) {
  if (filtered && !query) return 'No genres match the filters.';
  if (query) return `No genre or synonym matches "${query.trim()}".`;
  return EMPTY_TEXT;
}

export function graphStatusText({ total, mine, shown, onMapNow, libraryOnly }) {
  if (libraryOnly) return `${mine} ${plural(mine, 'genre', 'genres')} in your library${onMapNow}`;
  const scope = shown === total ? '' : ` (${shown} shown)`;
  return `${total} ${plural(total, 'genre', 'genres')}${scope}, ${mine} in your library${onMapNow}`;
}

export const radialTotalText = (total, label) => `${total} ${plural(total, 'genre', 'genres')} in ${label}`;
