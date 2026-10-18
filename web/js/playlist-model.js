import { plural } from './dom.js';
import { addBody, storedTags } from './song-payload.js';

export const DETAIL_BATCH = 10;
export const DETAIL_PARALLEL = 1;
export const RATE_LIMIT_NOTE = 'YouTube is rate-limiting this server, try again later';

export const isListed = (row) => row.state === 'ok';

export const defaultChecked = (row) => isListed(row) && !row.duplicate && !row.long;

export function markOf(row, outcome) {
  if (outcome?.kind === 'added') return { kind: 'added', text: 'Added' };
  if (outcome?.kind === 'failed') return { kind: 'failed', text: 'Failed', tip: outcome.message };
  if (!isListed(row)) return { kind: 'unavailable', text: 'Unavailable', tip: row.reason ? `${row.reason} video` : null };
  if (row.duplicate) return { kind: 'library', text: 'In library', tip: row.duplicate === 'id' ? 'This video is already in your library' : 'A song with the same title, artists and version is already in your library' };
  if (row.long) return { kind: 'long', text: 'Over 5 min' };
  return null;
}

export const canTick = (row, outcome) => isListed(row) && outcome?.kind !== 'added';

export const counterText = (selected, total) => `${selected} of ${total} selected`;

export const addLabel = (n) => `Add ${n} ${plural(n, 'song', 'songs')}`;

export function playlistNote(playlist) {
  if (!playlist) return '';
  const count = `${playlist.total} ${plural(playlist.total, 'video', 'videos')}`;
  if (playlist.truncated) return `${count}. Showing the first ${playlist.limit} of ${playlist.total}.`;
  return count;
}

export function mergeDetails(rows, entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const changed = [];
  const next = rows.map((row) => {
    const found = byId.get(row.id);
    if (!found || row.state !== 'ok') return row;
    changed.push(found.id);
    return { ...found };
  });
  return { rows: next, changed };
}

export function markUnavailable(rows, ids) {
  const gone = new Set(ids || []);
  const changed = [];
  const next = rows.map((row) => {
    if (!gone.has(row.id) || row.state !== 'ok') return row;
    changed.push(row.id);
    return { ...row, state: 'unavailable', reason: 'Unavailable', duplicate: null, long: false };
  });
  return { rows: next, changed };
}

export function quotaPlan(count, usage) {
  const max = usage?.max_songs;
  if (max == null) return { allowed: count, over: 0, max: null, room: null };
  const room = Math.max(0, max - (usage.songs || 0));
  const allowed = Math.min(count, room);
  return { allowed, over: count - allowed, max, room };
}

export function quotaNote(plan) {
  if (!plan.over) return '';
  if (!plan.allowed) return `Your library is full (${plan.max} songs). Delete some songs to add more.`;
  return `Your library holds ${plan.max} songs, so only ${plan.allowed} of ${plan.allowed + plan.over} fit. The first ${plan.allowed} will be added.`;
}

export const postArgs = (row) => [row.url, addBody(row), storedTags(row.tags), false, row.raw ?? null];

const STOPS = new Set(['library_full_songs', 'library_full_bytes', 'server_full', 'hourly_limit', 'import_limit', 'guest_limit', 'signup_closed']);
export const stops = (ex) => ex.status === 0 || ex.status === 401 || ex.status === 429 || STOPS.has(ex.code);

/** Adds the rows one after another through `add(...args)`; stops at a failure that would repeat for every song (quota, rate limit, sign-in, server down). */
export async function runAdd(rows, add, { onStart = () => {}, onDone = () => {}, signal } = {}) {
  const out = { added: [], failed: [], inLibrary: [], skipped: [], stop: null };
  for (let i = 0; i < rows.length; i += 1) {
    if (signal?.aborted) {
      out.skipped = rows.slice(i).map((r) => r.id);
      break;
    }
    const row = rows[i];
    onStart(row, i, rows.length);
    try {
      const got = await add(...postArgs(row));
      out.added.push({ id: row.id, song: got?.song ?? null });
      onDone(row, { kind: 'added' });
    } catch (ex) {
      if (ex.status === 409 && /already in library/i.test(ex.message)) {
        out.inLibrary.push(row.id);
        onDone(row, { kind: 'library' });
      } else if (stops(ex)) {
        out.stop = { code: ex.code || '', status: ex.status, message: ex.message };
        out.skipped = rows.slice(i).map((r) => r.id);
        onDone(row, { kind: 'stopped', message: ex.message });
        break;
      } else {
        out.failed.push({ id: row.id, message: ex.message });
        onDone(row, { kind: 'failed', message: ex.message });
      }
    }
  }
  return out;
}

export function summaryText(res, over = 0) {
  const n = res.added.length;
  const parts = [`Added ${n} ${plural(n, 'song', 'songs')}`];
  if (res.failed.length) parts.push(`${res.failed.length} failed`);
  if (res.inLibrary.length) parts.push(`${res.inLibrary.length} already in the library`);
  if (res.stop) parts.push(`stopped: ${res.stop.message}`);
  if (over) parts.push(`${over} over your library limit`);
  if (res.skipped.length) parts.push(`${res.skipped.length} not added`);
  return parts.length === 1 ? parts[0] : `${parts[0]} (${parts.slice(1).join(', ')})`;
}
