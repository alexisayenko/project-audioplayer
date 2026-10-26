import { store } from './store.js';
import { fmtTime } from './dom.js';
import { storeGet, storeSet } from './storage.js';

export const ALBUMS_KEY = 'electrophone.albumsView';

export const countOf = (a) => (a.tracks ? a.tracks.length : a.trackCount || 0);

const seconds = (tracks) => (tracks || []).map((t) => t.durationS).filter((n) => Number.isFinite(n) && n >= 0);

export function totalTime(tracks) {
  const secs = seconds(tracks);
  return secs.length ? fmtTime(secs.reduce((x, y) => x + y, 0)) : '';
}

const bpmValues = (tracks) => (tracks || []).filter((t) => t.songId).map((t) => Number(store.get(t.songId)?.bpm)).filter((n) => Number.isFinite(n) && n > 0);

export function bpmRange(tracks) {
  const v = bpmValues(tracks);
  if (!v.length) return '';
  const lo = Math.round(Math.min(...v));
  const hi = Math.round(Math.max(...v));
  return lo === hi ? `${lo} bpm` : `${lo} - ${hi} bpm`;
}

export const FACETS = [
  { id: 'genres', name: 'Genres', of: (a) => (Array.isArray(a.genres) ? a.genres.filter(Boolean) : []) },
  { id: 'years', name: 'Years', of: (a) => (a.year ? [String(a.year)] : []) },
];

export function facetValues(albums, facet) {
  const counts = new Map();
  for (const a of albums) for (const v of new Set(facet.of(a))) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((x, y) => (facet.id === 'years' ? y.value.localeCompare(x.value) : x.value.localeCompare(y.value)));
}

const anyOf = (have, want) => have.some((v) => want.has(v));

export function matchesFacets(album, sel) {
  return FACETS.every((f) => !sel[f.id].size || anyOf(f.of(album), sel[f.id]));
}

const fold = (s) => String(s ?? '').normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();

export function matchesQuery(album, query) {
  const q = fold(query);
  if (!q) return true;
  const hay = [album.title, album.artist, ...FACETS[0].of(album), ...(album.tracks || []).map((t) => t.title)];
  return hay.some((h) => fold(h).includes(q));
}

const missingLast = (ax, bx, dir) => {
  const am = ax == null;
  const bm = bx == null;
  if (am || bm) {
    if (am === bm) return 0;
    return am ? 1 : -1;
  }
  return dir * (ax - bx);
};
const text = (s) => fold(s);

export const ALBUM_SORTS = {
  added: ['Recently added', (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))],
  title: ['Title', (a, b) => text(a.title).localeCompare(text(b.title))],
  artist: ['Artist', (a, b) => text(a.artist).localeCompare(text(b.artist)) || text(a.title).localeCompare(text(b.title))],
  year: ['Year', (a, b) => missingLast(a.year || null, b.year || null, -1)],
  tracks: ['Tracks', (a, b) => countOf(b) - countOf(a)],
  length: ['Length', (a, b) => {
    const sum = (x) => (seconds(x.tracks).length ? seconds(x.tracks).reduce((p, q) => p + q, 0) : null);
    return missingLast(sum(a), sum(b), -1);
  }],
  bpm: ['BPM', (a, b) => {
    const lo = (x) => { const v = bpmValues(x.tracks); return v.length ? Math.min(...v) : null; };
    return missingLast(lo(a), lo(b), 1);
  }],
};

export const albumPrefs = { sort: 'added', reverse: false, sel: { genres: new Set(), years: new Set() } };

export function sortedAlbums(list) {
  const cmp = (ALBUM_SORTS[albumPrefs.sort] || ALBUM_SORTS.added)[1];
  const out = [...list].sort(cmp);
  return albumPrefs.reverse ? out.reverse() : out;
}

export function loadAlbumPrefs() {
  try {
    const raw = JSON.parse(storeGet(ALBUMS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.sort === 'string' && raw.sort in ALBUM_SORTS) albumPrefs.sort = raw.sort;
    albumPrefs.reverse = raw.reverse === true;
    for (const f of FACETS) {
      albumPrefs.sel[f.id] = new Set(Array.isArray(raw[f.id]) ? raw[f.id].filter((x) => typeof x === 'string') : []);
    }
  } catch { /* a damaged value is ignored */ }
}

export function saveAlbumPrefs() {
  try {
    storeSet(ALBUMS_KEY, JSON.stringify({ sort: albumPrefs.sort, reverse: albumPrefs.reverse, genres: [...albumPrefs.sel.genres], years: [...albumPrefs.sel.years] }));
  } catch { /* nothing to save to */ }
}

loadAlbumPrefs();
