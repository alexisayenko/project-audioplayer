import { songGenres } from './genre-playing.js';

export const GENRE_COLUMNS = [
  { key: 'genre', label: 'Genre', listening: false },
  { key: 'songs', label: 'Songs', listening: false },
  { key: 'listened', label: 'Total listened', listening: true },
  { key: 'plays', label: 'Times listened', listening: true },
];

export const DEFAULT_SORT = { key: 'listened', dir: -1 };
export const EMPTY_GENRES = 'No genres yet.';
export const MULTI_NOTE = 'A song with several genres counts in each of them.';

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function formatListened(seconds) {
  const s = num(seconds);
  if (!s) return '-';
  if (s < 60) return 'under 1 min';
  const mins = Math.floor(s / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${mins} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatPlays = (n) => (num(n) ? String(Math.round(num(n))) : '-');

export function genreRows(songs, listening) {
  const byKey = new Map();
  const entries = listening?.songs || {};
  for (const song of songs || []) {
    const e = entries[song.id];
    const seconds = num(e?.total_listened_s);
    const plays = num(e?.listened?.all);
    for (const g of songGenres(song)) {
      let row = byKey.get(g.key);
      if (!row) { row = { key: g.key, label: g.label, songs: 0, listened: 0, plays: 0 }; byKey.set(g.key, row); }
      row.songs += 1;
      row.listened += seconds;
      row.plays += plays;
    }
  }
  return [...byKey.values()];
}

export function totalsOf(songs, listening) {
  const entries = listening?.songs || {};
  let listened = 0;
  let plays = 0;
  for (const song of songs || []) {
    listened += num(entries[song.id]?.total_listened_s);
    plays += num(entries[song.id]?.listened?.all);
  }
  return { songs: (songs || []).length, listened, plays };
}

const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

export function sortGenres(rows, { key, dir }) {
  const sign = dir < 0 ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === 'genre') return sign * byLabel(a, b);
    return sign * (a[key] - b[key]) || b.songs - a.songs || byLabel(a, b);
  });
}

export function filterGenres(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  return q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.key.includes(q)) : rows;
}

export const nextSort = (sort, key) => (sort.key === key
  ? { key, dir: -sort.dir }
  : { key, dir: key === 'genre' ? 1 : -1 });

export const genreTag = (row) => `genre:${row.key}`;
