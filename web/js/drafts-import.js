import { MAX_LINE } from './drafts-model.js';
import { plural } from './dom.js';

export const CHUNK = 10;
export const PLAYLIST_CAP = 500;
export const MSG_PRIVATE = 'This playlist is private or not available.';
export const MSG_FAILED = 'Could not read the playlist. Try again.';
export const MSG_BAD_LINK = 'That does not look like a YouTube playlist link.';

const YT_LINK = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"']+/gi;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NOISE = '(?:official\\s+)?(?:(?:music|lyric|hd|4k)\\s+)?(?:video|audio|visuali[sz]er|lyrics?)|official|hd|hq|4k|audio|video|lyrics?';
const BRACKETED_NOISE = new RegExp(`\\s*[\\(\\[]\\s*(?:${NOISE})\\s*[\\)\\]]`, 'gi');
const TRAILING_NOISE = /\s*[|\-–—:]?\s*(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?(?:\s+video)?|hd|hq|4k)\s*$/i;
const EDGE = ' \t-–—|:,;.';

const squash = (s) => String(s ?? '').split(/\s+/).filter(Boolean).join(' ');

function trimEdges(s) {
  let from = 0;
  let to = s.length;
  while (from < to && EDGE.includes(s[from])) from += 1;
  while (to > from && EDGE.includes(s[to - 1])) to -= 1;
  return s.slice(from, to);
}

export function stripNoise(text) {
  let out = squash(text);
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(BRACKETED_NOISE, '').replace(TRAILING_NOISE, '');
    if (next === out) break;
    out = next;
  }
  return trimEdges(squash(out));
}

export function cleanChannel(channel) {
  return trimEdges(squash(String(channel ?? '').replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '')));
}

/** `{artist, title}` of a video: the first " - " splits "Artist - Title"; without one the channel is the artist. Noise words are removed, version words stay. */
export function splitVideoTitle(rawTitle, channel) {
  const cleaned = stripNoise(rawTitle);
  const at = cleaned.indexOf(' - ');
  if (at > 0) {
    const artist = trimEdges(cleaned.slice(0, at));
    const title = trimEdges(cleaned.slice(at + 3));
    if (artist && title) return { artist, title };
  }
  return { artist: cleanChannel(channel), title: cleaned || squash(rawTitle) };
}

export function videoIdOf(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1, 12);
      return VIDEO_ID.test(id) ? id : '';
    }
    const v = u.searchParams.get('v');
    if (v && VIDEO_ID.test(v)) return v;
    const m = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** The playlist link in a line, or null. A video link of an auto-generated mix (list=RD...) stays a plain video link. */
export function playlistLinkOf(line) {
  for (const found of String(line ?? '').match(YT_LINK) ?? []) {
    let u;
    try { u = new URL(found.replace(/[).\],;!?]+$/, '')); } catch { continue; }
    const list = u.searchParams.get('list');
    if (!list) continue;
    if (list.startsWith('RD') && u.searchParams.get('v')) continue;
    return { id: list, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}` };
  }
  return null;
}

/** The pasted lines in order as plain lines and playlists; a repeated playlist is read once. */
export function classify(lines) {
  const items = [];
  const seen = new Set();
  for (const line of lines) {
    const pl = playlistLinkOf(line);
    if (!pl) { items.push({ kind: 'line', line }); continue; }
    if (seen.has(pl.id)) continue;
    seen.add(pl.id);
    items.push({ kind: 'playlist', url: pl.url, id: pl.id });
  }
  return items;
}

export const hasPlaylist = (lines) => lines.some((l) => playlistLinkOf(l));

/** The draft line of a playlist entry, "Artist - Title <link>", kept within the line limit. */
export function entryLine(entry) {
  const url = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;
  const { artist, title } = splitVideoTitle(entry.title, entry.channel);
  const room = MAX_LINE - url.length - 1;
  const text = (artist ? `${artist} - ${title}` : title).slice(0, room).trim();
  return `${text} ${url}`.trim();
}

export function existingVideoIds({ drafts = [], songs = [] } = {}) {
  const ids = new Set();
  for (const d of drafts) {
    const id = videoIdOf(d.url);
    if (id) ids.add(id);
  }
  for (const s of songs) if (VIDEO_ID.test(String(s.id ?? ''))) ids.add(s.id);
  return ids;
}

export function playlistError(ex) {
  if (ex?.status === 422 || ex?.code === 'playlist_unavailable') return MSG_PRIVATE;
  if (ex?.status === 400) return MSG_BAD_LINK;
  if (ex?.status === 401 || ex?.status === 403) return ex.message;
  return MSG_FAILED;
}

/**
 * Resolves the playlists, then adds every line in chunks (one save per chunk), so an interrupted import keeps what was added.
 * `fetchPlaylist(url)` and `addLines(lines)` (returns the paste response) are injected; `isCancelled()` is checked between steps.
 */
export async function runImport({ lines, fetchPlaylist, addLines, ids = new Set(), onProgress = () => {}, isCancelled = () => false, chunk = CHUNK }) {
  const r = { added: 0, duplicates: 0, unavailable: 0, truncated: 0, overCap: 0, unfetched: 0, rateLimited: false, errors: [], cancelled: false, total: 0, done: 0, failed: '' };
  const queue = [];
  const taken = new Set(ids);
  for (const item of classify(lines)) {
    if (isCancelled()) { r.cancelled = true; return r; }
    if (item.kind === 'line') { queue.push(item.line); continue; }
    onProgress({ phase: 'reading', done: 0, total: 0 });
    let list;
    try {
      list = await fetchPlaylist(item.url);
    } catch (ex) {
      r.errors.push(playlistError(ex));
      continue;
    }
    if (list?.truncated) r.truncated += 1;
    r.unavailable += Number(list?.skipped) || 0;
    for (const e of list?.entries ?? []) {
      if (!e.available || !e.id) { r.unavailable += 1; continue; }
      if (taken.has(e.id)) { r.duplicates += 1; continue; }
      taken.add(e.id);
      queue.push(entryLine(e));
    }
  }
  r.total = queue.length;
  onProgress({ phase: 'adding', done: 0, total: r.total });
  for (let i = 0; i < queue.length; i += chunk) {
    if (isCancelled()) { r.cancelled = true; break; }
    const part = queue.slice(i, i + chunk);
    try {
      const c = (await addLines(part))?.counts ?? {};
      r.added += c.created ?? 0;
      r.duplicates += c.duplicates ?? 0;
      r.overCap += c.overCap ?? 0;
      r.unfetched += c.unfetched ?? 0;
      r.rateLimited ||= !!c.rateLimited;
    } catch (ex) {
      r.failed = ex.message;
      break;
    }
    r.done = i + part.length;
    onProgress({ phase: 'adding', done: r.done, total: r.total });
  }
  return r;
}

/** The sentences that tell what an import did. */
export function summarizeImport(r) {
  const parts = [];
  const skipped = [];
  if (r.duplicates) skipped.push(`skipped ${r.duplicates} already in your Drafts or Library`);
  if (r.unavailable) skipped.push(`${r.unavailable} unavailable`);
  if (r.total || skipped.length || !r.errors.length) parts.push(`${[`Added ${r.added}`, ...skipped].join(', ')}.`);
  if (r.cancelled) parts.push(`Cancelled after ${r.done} of ${r.total}: the ${r.added} added ${plural(r.added, 'draft is', 'drafts are')} kept.`);
  if (r.failed) parts.push(`Stopped after ${r.done} of ${r.total}: ${r.failed}`);
  if (r.truncated) parts.push(`A playlist has more than ${PLAYLIST_CAP} videos: only the first ${PLAYLIST_CAP} were read.`);
  if (r.overCap) parts.push(`The draft limit is reached: ${r.overCap} not added.`);
  if (r.unfetched) parts.push(`${r.unfetched} not fetched yet${r.rateLimited ? ' (YouTube is limiting requests)' : ''}. Use Refresh on a row later.`);
  parts.push(...r.errors);
  return parts.join(' ');
}
