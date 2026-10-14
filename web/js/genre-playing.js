import { tagLabel } from './tagname.js';

const normValue = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');

export function songGenres(song) {
  const seen = new Set();
  const out = [];
  for (const t of song?.tags || []) {
    const i = String(t).indexOf(':');
    if (i <= 0 || t.slice(0, i).trim().toLowerCase() !== 'genre') continue;
    const key = normValue(t.slice(i + 1));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ tag: `genre:${key}`, key, label: tagLabel(`genre:${key}`) });
  }
  return out;
}

export function mapToNodes(genres, g) {
  const owner = new Map();
  for (const n of g?.nodes || []) {
    for (const k of n.tags?.length ? n.tags : [n.label.toLowerCase()]) owner.set(normValue(k), n.id);
  }
  return genres.map((x) => ({ ...x, id: owner.get(x.key) || null }));
}

export const nodeIds = (items) => [...new Set(items.map((x) => x.id).filter(Boolean))];

export function nowPlayingState(song, items) {
  if (!song) return { kind: 'idle', hint: 'Nothing playing' };
  if (!items.length) return { kind: 'none', hint: 'This song has no genres' };
  return { kind: 'ready', hint: 'Genres of the playing song' };
}
