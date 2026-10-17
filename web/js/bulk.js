import { plural, fmtTime } from './dom.js';
import { displayLine } from './credits.js';
import { hasAudio } from './playable.js';
import { LONG_SONG_SECONDS } from './constants.js';

export const STREAK_STOP = 3;

export function metaLead(n) {
  if (!n) return 'Every downloaded song has its metadata.';
  return `${n} downloaded ${plural(n, 'song has', 'songs have')} no metadata yet`;
}

export const metaNormalize = (s) => ({ ...s, done: (s.updated || 0) + (s.nothing || 0) });

export const metaButton = (s) => (s.candidates > 0 || s.state === 'running' ? 'Get metadata' : 'Nothing to do');

const metaTally = (s) => `${s.updated} updated, ${s.nothing} nothing found, ${s.failed} failed`;

export function metaStatus(s) {
  const seen = (s.updated || 0) + (s.nothing || 0) + (s.failed || 0) + (s.skipped || 0);
  if (s.state === 'running') {
    const failedNote = s.failed ? ` (${s.failed} failed)` : '';
    return `Getting metadata... ${seen} of ${s.total}${failedNote}`;
  }
  if (!seen) return '';
  if (s.state === 'done') return `Done: ${metaTally(s)}.`;
  if (s.state === 'cancelled') return `Cancelled: ${metaTally(s)}.`;
  if (s.state === 'error') {
    const lastError = s.last_error ? ` (${s.last_error})` : '';
    return `Stopped by an error after ${metaTally(s)}${lastError}.`;
  }
  return '';
}

export const missingAudio = (songs) => songs.filter((s) => !hasAudio(s));

export const isLong = (song) => {
  const d = Number(song?.duration);
  return Number.isNaN(d) || d <= 0 || d > LONG_SONG_SECONDS;
};

export function splitLong(songs) {
  return { short: songs.filter((s) => !isLong(s)), long: songs.filter(isLong) };
}

export function longText(long, shown = 3) {
  const n = long.length;
  const head = long.slice(0, shown).map((s) => {
    const name = displayLine(s) || s.id;
    return `${name} (${Number(s.duration) > 0 ? fmtTime(s.duration) : 'unknown length'})`;
  }).join('; ');
  const more = n > shown ? `; and ${n - shown} more` : '';
  return `${n} ${plural(n, 'song is', 'songs are')} longer than ${LONG_SONG_SECONDS / 60} minutes or have no known length: ${head}${more}.`;
}

export function downloadLead(n) {
  if (!n) return 'Every song in the library is downloaded.';
  return `${n} ${plural(n, 'song is', 'songs are')} not downloaded yet`;
}

export function confirmText(n, usage) {
  const base = `Download ${n} ${plural(n, 'song', 'songs')}, one after another. Keep this page open.`;
  const max = usage?.max_adds;
  if (max == null) return base;
  const room = Math.max(0, max - (usage.adds_last_hour || 0));
  if (n <= room) return `${base} Your limit is ${max} per hour; ${room} left now.`;
  const hours = Math.ceil((n - room) / max);
  return `${base} Your limit is ${max} per hour (${room} left now), so it will pause and resume by itself, about ${hours} ${plural(hours, 'hour', 'hours')} in all.`;
}

export const newRun = (ids, longSkipped = 0) => ({ ids: [...ids], results: {}, order: [], stopped: false, longSkipped });

export function settle(run, id, kind, error = '') {
  if (run.results[id]) return run;
  return { ...run, results: { ...run.results, [id]: { kind, error } }, order: [...run.order, id] };
}

export function streak(run) {
  let n = 0;
  for (let i = run.order.length - 1; i >= 0 && run.results[run.order[i]].kind === 'failed'; i -= 1) n += 1;
  return n;
}

export const tally = (run) => {
  const count = (kind) => run.order.filter((id) => run.results[id].kind === kind).length;
  return { done: count('done'), failed: count('failed'), skipped: count('skipped'), left: run.ids.length - run.order.length };
};

export function runPercent(run) {
  return run.ids.length ? Math.min(100, Math.round((run.order.length / run.ids.length) * 100)) : 0;
}

export function runText(run, { running, pausedMinutes }) {
  const t = tally(run);
  const failed = t.failed ? ` (${t.failed} failed)` : '';
  if (running) {
    const pause = pausedMinutes > 0 ? ` Paused by the hourly limit, continues in ${pausedMinutes} min.` : '';
    return `Downloading... ${run.order.length} of ${run.ids.length}${failed}.${pause}`;
  }
  const long = run.longSkipped ? `, ${run.longSkipped} long ${plural(run.longSkipped, 'song', 'songs')} skipped` : '';
  const skipped = t.skipped ? `, ${t.skipped} skipped` : '';
  const left = t.left ? `, ${t.left} not started` : '';
  const tail = `${t.done} downloaded, ${t.failed} failed${skipped}${left}${long}`;
  if (run.stopped) return `Stopped after ${STREAK_STOP} failures in a row: ${tail}.`;
  if (run.cancelled) return `Cancelled: ${tail}.`;
  return `Done: ${tail}.`;
}

export function failedList(run, songs) {
  return run.order.filter((id) => run.results[id].kind === 'failed').map((id) => {
    const s = songs.find((x) => x.id === id);
    const name = s ? displayLine(s) || id : id;
    const why = run.results[id].error;
    const reason = why ? `: ${why}` : '';
    return `${name} (${id})${reason}`;
  });
}
