import { plural } from './dom.js';

export const ALBUM_TYPES = [['album', 'Album'], ['EP', 'EP'], ['single', 'Single'], ['mix', 'Mix'], ['compilation', 'Compilation']];
export const normalType = (t) => ALBUM_TYPES.find(([k]) => k.toLowerCase() === String(t ?? '').toLowerCase())?.[0] || 'album';

const two = (n) => String(n).padStart(2, '0');

export function lengthText(sec) {
  const m = Math.round(Math.max(0, sec) / 60);
  if (m < 1) return `${Math.round(Math.max(0, sec))} s`;
  const h = Math.floor(m / 60);
  return h ? `${h} h ${two(m % 60)} min` : `${m} min`;
}

export function trackClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

export const joinArtists = (list) => (Array.isArray(list) ? list.filter(Boolean).join(' & ') : '');
export const splitArtists = (text) => String(text ?? '').split('&').map((a) => a.trim()).filter(Boolean);

export function extraLinks(links) {
  const out = {};
  for (const [k, v] of Object.entries(links || {})) if (k !== 'youtube' && String(v ?? '').trim()) out[k] = String(v).trim();
  return Object.keys(out).length ? out : null;
}

let seq = 0;

export function baseRow(t, i, extra = {}) {
  seq += 1;
  return {
    key: seq,
    include: true,
    artists: joinArtists(t.artists ?? (t.artist ? [t.artist] : [])),
    title: String(t.title ?? ''),
    version: String(t.version ?? ''),
    warnings: [],
    editing: false,
    no: i + 1,
    ...extra,
  };
}

export function albumOf(preview, address, youtube) {
  const g = preview.guess || {};
  const a = preview.album || { title: g.album ?? preview.title, albumArtist: g.artist ?? preview.artist, year: g.year ?? preview.year, type: g.type ?? preview.type };
  return {
    title: String(a.title ?? ''),
    albumArtist: String(a.albumArtist ?? ''),
    type: normalType(a.type),
    year: Number.isInteger(a.year) ? String(a.year) : '',
    genres: (Array.isArray(a.genres) ? a.genres : Array.isArray(preview.genres) ? preview.genres : []).filter((x) => typeof x === 'string' && x.trim()),
    links: { ...extraLinks(preview.links), youtube: youtube || address },
    coverUrl: a.coverUrl || preview.thumbnail || null,
  };
}

export function albumIssues(st) {
  const out = [];
  if (!st.album.title.trim()) out.push('Give the album a title.');
  const year = st.album.year.trim();
  if (year && !/^\d{4}$/.test(year)) out.push('Year must have four digits.');
  return out;
}

export function albumPayload(st) {
  const a = st.album;
  const year = a.year.trim();
  return {
    title: a.title.trim(),
    albumArtist: a.albumArtist.trim(),
    type: a.type,
    year: year ? Number(year) : null,
    genres: a.genres,
    coverUrl: a.coverUrl || null,
    ...(extraLinks(a.links) ? { links: extraLinks(a.links) } : {}),
  };
}

export function nameOf(r) {
  const name = [r.artists.trim(), r.title.trim()].filter(Boolean).join(' - ');
  return { name: name || 'Untitled track', version: r.version.trim() };
}

export function countLine(included, seconds, warns) {
  const parts = [`${included} ${plural(included, 'track', 'tracks')}`];
  if (included && seconds > 0) parts.push(lengthText(seconds));
  if (warns) parts.push(`${warns} ${plural(warns, 'warning', 'warnings')}`);
  return parts.join(' · ');
}

export function renumber(st) {
  st.rows.forEach((r, i) => { r.no = i + 1; });
}
