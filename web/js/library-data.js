import { store } from './store.js';
import { sortKey, compareKeys, displayYear } from './credits.js';
import { songMatches } from './song-match.js';
import { referenceSongIds } from './references.js';
import { canonicalTag, categoryOf, withRuntimeDecade } from './tagname.js';

const UNSET_KEYS = { genres: 'genre', years: 'decade', countries: 'country' };
const UNSET_NOUN = { genres: 'genre', years: 'year', countries: 'country' };
export const UNSET_TOKEN = '__unset__';

export function unsetKey(catId) {
  return UNSET_KEYS[catId] ? `${UNSET_KEYS[catId]}:${UNSET_TOKEN}` : null;
}

export const isUnsetKey = (k) => Object.values(UNSET_KEYS).some((x) => k === `${x}:${UNSET_TOKEN}`);
export const unsetLabel = (catId) => `Songs with no ${UNSET_NOUN[catId] || 'value'}`;

function hasValueIn(song, catId) {
  return (withRuntimeDecade(song).tags || []).some((t) => categoryOf(canonicalTag(t).toLocaleLowerCase()) === catId);
}

export function unsetCount(catId, songs = store.songs) {
  return unsetKey(catId) ? songs.filter((s) => !hasValueIn(s, catId)).length : 0;
}

export const prefs = { query: '', sel: new Set(), sort: 'added', view: 'songs', never: false, reverse: false, refs: '' };

let listening = null;

export function setListening(data) {
  listening = data && data.songs ? data : null;
  if (listening) return;
  prefs.never = false;
  if (prefs.sort === 'listened') prefs.sort = 'added';
}

export const hasListening = () => !!listening;
export const listeningData = () => listening;

const lastListened = (song) => listening?.songs?.[song.id]?.last_listened || '';

export function neverListened(song) {
  const e = listening?.songs?.[song.id];
  return !e || (e.listened?.all || 0) + (e.skipped?.all || 0) === 0;
}

export const neverCount = (songs = store.songs) => songs.filter(neverListened).length;

export function filterByTags(tags) {
  const have = new Set(store.tags.map((t) => t.tag.toLocaleLowerCase()));
  prefs.query = '';
  prefs.sel = new Set(tags.map((t) => canonicalTag(t).toLocaleLowerCase()).filter((t) => have.has(t) || isUnsetKey(t)));
}

export const SORTS = {
  added: ['Recently added', (a, b) => (b.added_at || '').localeCompare(a.added_at || '')],
  title: ['Title', (a, b) => compareKeys(sortKey(a, 'title'), sortKey(b, 'title'))],
  artist: ['Artist', (a, b) => compareKeys(sortKey(a, 'artist'), sortKey(b, 'artist'))],
  year: ['Year', (a, b) => (displayYear(b) || 0) - (displayYear(a) || 0), (s) => !displayYear(s)],
  listened: ['Last listened', (a, b) => lastListened(b).localeCompare(lastListened(a)), (s) => !lastListened(s)],
  bpm: ['BPM', (a, b) => (a.bpm == null) - (b.bpm == null) || (a.bpm || 0) - (b.bpm || 0), (s) => s.bpm == null],
  length: ['Length', (a, b) => (!(a.duration > 0)) - (!(b.duration > 0)) || (a.duration || 0) - (b.duration || 0) || compareKeys(sortKey(a, 'title'), sortKey(b, 'title')), (s) => !(s.duration > 0)],
};

function matchesSelection(song, sel) {
  if (!sel.size) return true;
  const mine = new Set((withRuntimeDecade(song).tags || []).map((t) => canonicalTag(t).toLocaleLowerCase()));
  const byCat = new Map();
  for (const t of sel) {
    const c = categoryOf(t);
    byCat.set(c, [...(byCat.get(c) || []), t]);
  }
  return [...byCat.entries()].every(([c, tags]) => tags.some((t) => (isUnsetKey(t) ? !hasValueIn(song, c) : mine.has(t))));
}

export function visibleSongs(sel = prefs.sel) {
  const q = prefs.query.trim().toLocaleLowerCase();
  const refIds = prefs.refs ? referenceSongIds(prefs.refs === 'any' ? '' : prefs.refs) : null;
  const list = store.songs.filter((s) => {
    if (refIds && !refIds.has(s.id)) return false;
    if (!matchesSelection(s, sel)) return false;
    if (prefs.never && listening && !neverListened(s)) return false;
    if (!q) return true;
    return songMatches(s, q);
  });
  const [, cmp, missing] = SORTS[prefs.sort];
  list.sort(cmp);
  if (!prefs.reverse) return list;
  if (!missing) return list.reverse();
  return [...list.filter((s) => !missing(s)).reverse(), ...list.filter(missing)];
}

export function selectedIn(catId) {
  const k = unsetKey(catId);
  return store.tags.filter((t) => categoryOf(t.tag) === catId && prefs.sel.has(t.tag.toLocaleLowerCase())).length + (k && prefs.sel.has(k) ? 1 : 0);
}
