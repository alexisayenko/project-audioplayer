import { plural } from './dom.js';

export const MAX_TRACKS = 100;
export const MAX_SECONDS = 4 * 3600;
export const ALBUM_TYPES = [
  ['album', 'Album'], ['EP', 'EP'], ['single', 'Single'], ['compilation', 'Compilation'],
  ['live', 'Live'], ['soundtrack', 'Soundtrack'], ['mix', 'DJ mix'],
];
export const FADE_TYPES = new Set(['mix', 'compilation']);

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function videoLink(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = '';
  if (host === 'youtu.be') id = parts[0] || '';
  else if (HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (parts[0] === 'shorts' || parts[0] === 'live') id = parts[1] || '';
  }
  return VIDEO_ID.test(id) ? { id, url: text } : null;
}

export const youtubeAt = (videoId, start) => `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(start))}`;

const two = (n) => String(n).padStart(2, '0');

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

export function parseClock(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,6}(:\d{1,2}){0,2}$/.test(s)) return null;
  const nums = s.split(':').map(Number);
  if (nums.length > 1 && nums.slice(1).some((n) => n > 59)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function lengthText(sec) {
  const m = Math.round(Math.max(0, sec) / 60);
  if (m < 1) return `${Math.round(Math.max(0, sec))} s`;
  const h = Math.floor(m / 60);
  return h ? `${h} h ${two(m % 60)} min` : `${m} min`;
}

export const joinArtists = (list) => (Array.isArray(list) ? list.filter(Boolean).join(' & ') : '');
export const splitArtists = (text) => String(text ?? '').split('&').map((a) => a.trim()).filter(Boolean);

let seq = 0;

export function rowOf(t, i) {
  seq += 1;
  return {
    key: seq,
    include: !t.match,
    start: Number(t.start) || 0,
    artists: joinArtists(t.artists),
    title: String(t.title ?? ''),
    version: String(t.version ?? ''),
    warnings: Array.isArray(t.warnings) ? t.warnings.filter(Boolean).map(String) : [],
    match: t.match && typeof t.match === 'object' ? t.match : null,
    useExisting: false,
    startText: formatClock(t.start),
    badStart: false,
    no: i + 1,
  };
}

export function stateOf(preview, address = '') {
  const a = preview.album || {};
  const tracks = (Array.isArray(preview.tracks) ? preview.tracks : []).map(rowOf);
  const type = ALBUM_TYPES.some(([k]) => k === a.type) ? a.type : 'album';
  return {
    videoId: preview.videoId || '',
    url: preview.url || address,
    videoTitle: preview.title || '',
    uploader: preview.uploader || '',
    duration: Number(preview.duration) || 0,
    source: preview.source || 'none',
    rawText: String(preview.rawText ?? ''),
    warnings: Array.isArray(preview.warnings) ? preview.warnings.filter(Boolean).map(String) : [],
    rows: tracks,
    endTime: Number(preview.duration) || 0,
    album: {
      title: String(a.title ?? ''),
      albumArtist: String(a.albumArtist ?? ''),
      type,
      year: Number.isInteger(a.year) ? String(a.year) : '',
      genres: [],
      coverUrl: a.coverUrl || preview.thumbnail || null,
    },
    fades: FADE_TYPES.has(type),
    fadesTouched: false,
    badEnd: false,
  };
}

export const endOf = (st, i) => (i + 1 < st.rows.length ? st.rows[i + 1].start : st.endTime);

export function renumber(st) {
  st.rows.forEach((r, i) => { r.no = i + 1; });
}

export function rowIssue(st, i) {
  const r = st.rows[i];
  if (!r.include) return '';
  if (r.badStart) return 'Start must look like 1:02:30.';
  if (!r.title.trim()) return 'Title is empty.';
  if (st.duration && r.start >= st.duration) return 'Starts after the end of the video.';
  const prev = i > 0 ? st.rows[i - 1].start : -1;
  if (r.start <= prev) return 'Must start after the previous track.';
  const end = endOf(st, i);
  if (end <= r.start) return 'Must end after it starts.';
  if (st.duration && end > st.duration) return 'Ends after the end of the video.';
  return '';
}

export function issues(st) {
  const out = [];
  const included = st.rows.filter((r) => r.include);
  if (st.badEnd) out.push('The last end time must look like 1:02:30.');
  if (!st.album.title.trim()) out.push('Give the album a title.');
  if (!included.length) out.push('Tick at least one track.');
  if (included.length > MAX_TRACKS) out.push(`At most ${MAX_TRACKS} tracks.`);
  const year = st.album.year.trim();
  if (year && !/^\d{4}$/.test(year)) out.push('Year must have four digits.');
  st.rows.forEach((_, i) => { if (rowIssue(st, i)) out.push(`Track ${i + 1}: ${rowIssue(st, i)}`); });
  return out;
}

export function summary(st) {
  const included = st.rows.map((r, i) => ({ r, i })).filter((x) => x.r.include);
  const total = included.reduce((acc, { r, i }) => acc + Math.max(0, endOf(st, i) - r.start), 0);
  const warns = st.rows.filter((r) => r.include && r.warnings.length).length + issues(st).length;
  const parts = [`${included.length} ${plural(included.length, 'track', 'tracks')}`];
  if (included.length) parts.push(lengthText(total));
  if (warns) parts.push(`${warns} ${plural(warns, 'warning', 'warnings')}`);
  return parts.join(' · ');
}

export function offsetAll(st, delta) {
  const cap = st.endTime || Infinity;
  for (const r of st.rows) {
    r.start = Math.min(Math.max(0, r.start + delta), cap);
    r.startText = formatClock(r.start);
  }
}

export function sortRows(st) {
  st.rows.sort((a, b) => a.start - b.start);
  renumber(st);
}

export const isSorted = (st) => st.rows.every((r, i) => i === 0 || st.rows[i - 1].start <= r.start);

export function addRow(st) {
  const last = st.rows.at(-1);
  const from = last ? last.start : 0;
  const to = st.endTime || from + 120;
  const start = Math.min(Math.max(from + 1, Math.floor((from + to) / 2)), Math.max(to - 1, 0));
  const r = rowOf({ start, title: '', artists: [], version: '', warnings: [], match: null }, st.rows.length);
  r.include = true;
  st.rows.push(r);
  renumber(st);
  return r;
}

export function payload(st) {
  const a = st.album;
  const year = a.year.trim();
  return {
    url: st.url,
    album: {
      title: a.title.trim(),
      albumArtist: a.albumArtist.trim(),
      type: a.type,
      year: year ? Number(year) : null,
      genres: a.genres,
      coverUrl: a.coverUrl || null,
    },
    tracks: st.rows.map((r, i) => ({
      include: r.include,
      start: r.start,
      end: endOf(st, i),
      artists: splitArtists(r.artists),
      title: r.title.trim(),
      version: r.version.trim() || null,
      trackNo: r.no,
      useExistingSongId: r.include && r.useExisting && r.match ? r.match.songId : null,
    })),
    fades: st.fades,
  };
}

export function previewErrorText(ex) {
  const detail = typeof ex?.data?.detail === 'string' ? ex.data.detail : '';
  if (ex?.status === 413) return detail ? `${detail[0].toUpperCase()}${detail.slice(1)}.` : 'This video is too long or has too many tracks.';
  if (ex?.status === 400) return 'This is not a valid YouTube video link.';
  if (ex?.status === 404) return 'YouTube has no video at this address, or it is private.';
  if (ex?.status === 429) return 'Too many lookups. Try again in a minute.';
  if (ex?.status === 502) return 'YouTube could not be read right now. Try again later.';
  return ex?.message || 'The video could not be read.';
}

const CREATE_422 = {
  bad_times: 'A track has wrong times. Check that each one starts before it ends and the tracks do not overlap.',
  bad_tracks: 'A track has an empty title or a wrong value. Check the titles, artists and track numbers.',
  no_tracks: 'Tick at least one track.',
  bad_album: 'The album title, artist, type or year is not valid.',
};

export function createErrorText(ex) {
  const detail = ex?.data?.detail;
  const code = ex?.code || (typeof detail === 'string' ? detail : detail?.code) || '';
  if (code === 'library_full_songs') return 'Your library is full. Remove some songs and try again.';
  if (code === 'library_full_bytes') return 'Your storage is full. Remove some songs and try again.';
  if (ex?.status === 429) return 'Hourly limit reached. Try again later.';
  if (ex?.status === 413) return previewErrorText(ex);
  if (ex?.status === 409) return code === 'album_limit' ? 'You have reached the album limit. Remove an album and try again.' : 'An album from this video already exists in your library.';
  if (ex?.status === 404 || code === 'unknown_song') return 'A song marked Use existing is no longer in your library. Reload and try again.';
  if (ex?.status === 422) return CREATE_422[code] || 'The track list could not be saved. Check the times and titles.';
  return ex?.message || 'The album could not be created.';
}
