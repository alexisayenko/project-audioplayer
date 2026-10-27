import { fold } from './album-candidates.js';
import { artistLine, titleLine } from './credits.js';
import { reviewView } from './album-wizard-model.js';

export const LINK_LIMIT = 8;

const key = (s) => fold(s).replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();

const added = (s) => String(s?.added_at ?? '');

export function searchSongs(songs, query, limit = LINK_LIMIT) {
  const list = Array.isArray(songs) ? songs.filter((s) => s && s.id) : [];
  const tokens = key(query).split(' ').filter(Boolean);
  if (!tokens.length) return [...list].sort((a, b) => added(b).localeCompare(added(a))).slice(0, limit);
  const whole = tokens.join(' ');
  const scored = [];
  for (const s of list) {
    const title = key(titleLine(s));
    const hay = `${key(artistLine(s))} ${title}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    scored.push({ s, rank: title.startsWith(whole) ? 0 : title.includes(whole) ? 1 : 2, title });
  }
  scored.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  return scored.slice(0, limit).map((x) => x.s);
}

export const matchOf = (song) => ({
  songId: String(song.id), title: titleLine(song), artists: Array.isArray(song.mainArtists) ? song.mainArtists.filter(Boolean) : [], manual: true,
});

export const linkText = (match) => [(match?.artists || []).join(' & '), match?.title].filter(Boolean).join(' - ');

export const effectiveMatch = (src, st) => st?.link || src?.match || null;

function holderOf(draft, songId, exceptKey) {
  for (const r of draft.st.rows) {
    if (r.key === exceptKey) continue;
    const st = draft.review.state.get(r.key);
    if (st?.include && st.useExisting && effectiveMatch(r, st)?.songId === songId) return r.key;
  }
  return null;
}

export function usedFor(draft, songId, exceptKey = null) {
  const view = reviewView(draft);
  const hit = view.rows.find((r) => r.key !== exceptKey && r.include && r.useExisting && r.match?.songId === String(songId));
  return hit ? hit.no : null;
}

export function releaseRow(draft, rowKey) {
  const st = draft.review.state.get(rowKey);
  if (!st) return;
  st.link = null;
  st.useExisting = false;
  st.include = false;
}

export function linkSong(draft, rowKey, song) {
  const st = draft.review.state.get(rowKey);
  if (!st || !song?.id) return false;
  const id = String(song.id);
  const holder = holderOf(draft, id, rowKey);
  if (holder !== null) releaseRow(draft, holder);
  st.link = matchOf(song);
  st.include = true;
  st.useExisting = true;
  return true;
}

export const unlinkSong = releaseRow;

export function clearLinks(draft) {
  for (const st of draft.review.state.values()) { st.link = null; st.useExisting = false; }
}
