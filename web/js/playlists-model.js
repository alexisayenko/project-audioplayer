import { plural } from './dom.js';

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 1000;

const SUFFIX = /^(.*) \((\d+)\)$/;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;

const HASH_ID = /^#\/?playlists\/([^/?#]+)/;

export function playlistIdOf(hash) {
  const hit = HASH_ID.exec(hash || '');
  if (!hit) return '';
  try { return decodeURIComponent(hit[1]); } catch { return ''; }
}

export const songCount =(n) => `${n} ${plural(n, 'song', 'songs')}`;

export function suggestName(name, taken) {
  const used = new Set(taken.map((t) => t.toLocaleLowerCase()));
  const hit = SUFFIX.exec(name);
  const base = hit ? hit[1] : name;
  let n = hit ? Number(hit[2]) + 1 : 2;
  const room = NAME_MAX - ` (${n})`.length;
  const stem = base.length > room ? base.slice(0, room).trimEnd() : base;
  while (used.has(`${stem} (${n})`.toLocaleLowerCase())) n += 1;
  return `${stem} (${n})`;
}

export function hoursMinutes(seconds) {
  const minutes = Math.max(1, Math.round(seconds / MINUTE));
  return `${Math.floor(minutes / MINUTE)}:${String(minutes % MINUTE).padStart(2, '0')}`;
}

export function totalText(songs) {
  const count = songCount(songs.length);
  const known = songs.filter((s) => Number(s.duration) > 0);
  if (!known.length) return count;
  const total = known.reduce((sum, s) => sum + Number(s.duration), 0);
  return `${count}, ${known.length < songs.length ? 'about ' : ''}${hoursMinutes(total)} total`;
}

export function changedText(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const age = Math.max(0, (now - then) / 1000);
  if (age < MINUTE) return 'Changed just now';
  if (age < HOUR) return `Changed ${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `Changed ${Math.floor(age / HOUR)} h ago`;
  if (age < WEEK) {
    const days = Math.floor(age / DAY);
    return days === 1 ? 'Changed yesterday' : `Changed ${days} days ago`;
  }
  return `Changed ${new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function moveId(ids, from, to) {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function dropIndex(count, from, slot) {
  const to = slot > from ? slot - 1 : slot;
  return Math.max(0, Math.min(count - 1, to));
}

export function insertId(ids, id, index) {
  if (ids.includes(id)) return ids;
  const next = [...ids];
  next.splice(Math.max(0, Math.min(next.length, index)), 0, id);
  return next;
}

export function exportName(filename, name) {
  if (filename) return filename;
  const stem = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').split(/\s+/).join(' ').trim().slice(0, 100);
  return `${stem || 'playlist'}.txt`;
}

export function queueNotes({ added = 0, already = 0, skipped = 0, fetching = 0 }) {
  const parts = [];
  if (already) parts.push(`${already} already in queue`);
  if (fetching) parts.push(`${fetching} downloading`);
  if (skipped) parts.push(`${skipped} ${plural(skipped, 'song', 'songs')} without audio skipped`);
  return `Added ${added} ${plural(added, 'song', 'songs')} to the queue${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

export function addedText(name, { added, skipped }, asked) {
  if (!added) return 'Already in the playlist';
  if (asked === 1) return `Added to ${name}`;
  const dup = skipped.length ? `, ${skipped.length} already there` : '';
  return `Added ${added} ${plural(added, 'song', 'songs')} to ${name}${dup}`;
}
