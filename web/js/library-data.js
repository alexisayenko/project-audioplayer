import { store } from './store.js';
import { visibleTags, canonicalTag, tagSearchText, categoryOf } from './tagname.js';

export const prefs = { query: '', sel: new Set(), sort: 'added' };

export function filterByTags(tags) {
  const have = new Set(store.tags.map((t) => t.tag.toLocaleLowerCase()));
  prefs.query = '';
  prefs.sel = new Set(tags.map((t) => canonicalTag(t).toLocaleLowerCase()).filter((t) => have.has(t)));
}

function cmp(a, b) {
  return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
}

export const SORTS = {
  added: ['Recently added', (a, b) => (b.added_at || '').localeCompare(a.added_at || '')],
  title: ['Title', (a, b) => cmp(a.title, b.title)],
  artist: ['Artist', (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title)],
  year: ['Year', (a, b) => (b.year || 0) - (a.year || 0)],
  bpm: ['BPM', (a, b) => (a.bpm == null) - (b.bpm == null) || (a.bpm || 0) - (b.bpm || 0)],
};

function matchesSelection(song, sel) {
  if (!sel.size) return true;
  const mine = new Set((song.tags || []).map((t) => canonicalTag(t).toLocaleLowerCase()));
  const byCat = new Map();
  for (const t of sel) {
    const c = categoryOf(t);
    byCat.set(c, [...(byCat.get(c) || []), t]);
  }
  return [...byCat.values()].every((tags) => tags.some((t) => mine.has(t)));
}

export function visibleSongs(sel = prefs.sel) {
  const q = prefs.query.trim().toLocaleLowerCase();
  const list = store.songs.filter((s) => {
    if (!matchesSelection(s, sel)) return false;
    if (!q) return true;
    const hay = [s.title, s.artist, s.album, ...visibleTags(s.tags).map(tagSearchText)].join('\n').toLocaleLowerCase();
    return hay.includes(q);
  });
  return list.sort(SORTS[prefs.sort][1]);
}

export function selectedIn(catId) {
  return store.tags.filter((t) => categoryOf(t.tag) === catId && prefs.sel.has(t.tag.toLocaleLowerCase())).length;
}
