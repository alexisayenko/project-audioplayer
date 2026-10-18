import { cleanUrl, classifySoundcloud } from './url-clean.js';
import { displayLine } from './credits.js';
import { plural } from './dom.js';

export const MAX_LINES = 100;
export const MAX_LINE = 300;
export const FETCHABLE = ['youtube', 'soundcloud'];
export const PLACEHOLDER = 'Paste "Artist - Title" or links, one per line';
export const EMPTY_TEXT = 'No drafts yet. Paste "Artist - Title" or links above to collect songs to add later.';
export const LINK_NOTE = 'Kept as plain link text: only YouTube and SoundCloud links are looked up.';
export const CREDIT_KEYS = ['title', 'mainArtists', 'featuredArtists', 'withArtists', 'version'];

const URL_RE = /https?:\/\/[^\s<>"']+|(?:(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)|(?:www\.|m\.|on\.)?soundcloud\.com)\/[^\s<>"']+/i;
const URL_TAIL = ').],;!?';
const EDGE = ' \t-–—|:,;.';
const EMPTY_PAIRS = /\[\s*\]|\(\s*\)|<\s*>|\{\s*\}/g;
const YOUTUBE_URL = /^https?:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

const squash = (s) => String(s).split(/\s+/).filter(Boolean).join(' ');

function trimSet(text, set, { start = true, end = true } = {}) {
  let from = 0;
  let to = text.length;
  while (start && from < to && set.includes(text[from])) from += 1;
  while (end && to > from && set.includes(text[to - 1])) to -= 1;
  return text.slice(from, to);
}

export function splitLines(raw) {
  return String(raw ?? '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

/** `{text, url}` of one line: the first link anywhere in it (cleaned) and the rest as the "Artist - Title" text. Twin of `line_parts` in server/app/drafts.py, both driven by server/tests/fixtures/draft_lines.json. */
export function lineParts(line) {
  const text = String(line ?? '');
  const found = URL_RE.exec(text);
  if (!found) return { text: squash(text), url: '' };
  const raw = trimSet(found[0], URL_TAIL, { start: false });
  const rest = `${text.slice(0, found.index)} ${text.slice(found.index + raw.length)}`.replace(EMPTY_PAIRS, ' ');
  const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return { text: trimSet(squash(rest), EDGE).trim(), url: cleanUrl(full) };
}

/** `youtube`, `soundcloud`, `link` (any other http(s) link) or null (no link). */
export function sourceOfUrl(url) {
  if (!url) return null;
  if (YOUTUBE_URL.test(url)) return 'youtube';
  const sc = classifySoundcloud(url);
  if (sc && (sc.kind === 'track' || sc.kind === 'short')) return 'soundcloud';
  return /^https?:\/\/[^\s/]+/i.test(url) ? 'link' : null;
}

/** What a paste sends: the first MAX_LINES lines that fit MAX_LINE characters, the lines past the cap (left in the box for the next paste) and the counts. */
export function prepare(raw) {
  const all = splitLines(raw);
  const taken = all.slice(0, MAX_LINES);
  const lines = taken.filter((l) => l.length <= MAX_LINE);
  return { lines, rest: all.slice(MAX_LINES), counts: { lines: all.length, overLineCap: Math.max(0, all.length - MAX_LINES), tooLong: taken.length - lines.length } };
}

export const rawLine = (d) => [d?.text, d?.url].filter(Boolean).join(' ');

export const isFetchable = (d) => FETCHABLE.includes(d?.source);

export const canRefresh = (d) => isFetchable(d) && d.state !== 'fetched';

export function linkLabel(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`;
  } catch {
    return String(url ?? '');
  }
}

/** The title shown for a draft: its parsed title, else the link as text, else the raw line. */
export const titleOf = (d) => d?.title || (d?.url ? linkLabel(d.url) : '') || rawLine(d);

export function statusOf(d) {
  if (d?.inLibrary) return { kind: 'library', label: 'In library' };
  if (d?.state === 'fetched') return { kind: 'fetched', label: 'Fetched' };
  if (isFetchable(d)) return d.state === 'failed' ? { kind: 'failed', label: 'Could not fetch' } : { kind: 'new', label: 'Not fetched yet' };
  if (d?.source === 'link') return { kind: 'link', label: 'Link only' };
  return { kind: 'text', label: 'Text only' };
}

export const countText = (n) => `${n} ${plural(n, 'draft', 'drafts')}`;

/** The Add dialog start for a draft: a supported link is loaded as if pasted; otherwise the dialog opens with a note and the draft's credits wait for the form of the pasted link. */
export function addPlan(d) {
  const label = d?.title ? displayLine(d) : rawLine(d);
  if (isFetchable(d)) return { url: d.url, credits: null, note: `From your drafts: ${label}.` };
  const credits = d?.title ? Object.fromEntries(CREDIT_KEYS.map((k) => [k, d[k]])) : null;
  const how = credits ? 'Title and Artists start from your text.' : 'Add the title and artists in the form.';
  return { url: '', credits, note: `From your drafts: ${label}. Paste its YouTube or SoundCloud link to continue. ${how}` };
}

export const replaceDraft = (list, one) => list.map((d) => (d.id === one.id ? one : d));

/** The list after a paste: new drafts first, rows that got a text replaced in place. */
export function mergePaste(items, resp) {
  const updated = new Map((resp?.updated ?? []).map((d) => [d.id, d]));
  return [...(resp?.created ?? []), ...items.map((d) => updated.get(d.id) ?? d)];
}

/** The sentences that tell what a paste did. */
export function summarize(counts, local = {}) {
  const c = counts ?? {};
  const parts = [];
  const n = c.created ?? 0;
  parts.push(n ? `Added ${n} ${plural(n, 'draft', 'drafts')}.` : 'Nothing new to add.');
  if (c.updated) parts.push(`${c.updated} ${plural(c.updated, 'draft', 'drafts')} updated with the pasted text.`);
  if (c.duplicates) parts.push(`${c.duplicates} already in your drafts.`);
  const long = (local.tooLong ?? 0) + (c.tooLong ?? 0);
  if (long) parts.push(`${long} ${plural(long, 'line', 'lines')} skipped (over ${MAX_LINE} characters).`);
  if (local.overLineCap) parts.push(`Only ${MAX_LINES} lines are added at once: ${local.overLineCap} left in the box.`);
  if (c.overCap) parts.push(`The draft limit is reached: ${c.overCap} not added.`);
  if (c.unfetched) {
    const why = c.rateLimited ? 'YouTube is limiting requests' : 'lookup incomplete';
    parts.push(`${c.unfetched} not fetched yet (${why}). Use Refresh on a row later.`);
  }
  return parts.join(' ');
}
