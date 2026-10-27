import { playlistLink, MIX_MESSAGE, PRIVATE_MESSAGE } from './playlist-link.js';
import { stateOf, videoLink, issues as videoIssues, payload as videoPayload, formatClock, endOf, summary as videoSummary, rowIssue as videoRowIssue } from './album-video-model.js';
import { playlistState, issues as playlistIssues, payload as playlistPayload, summary as playlistSummary, rowIssue as playlistRowIssue } from './album-youtube-model.js';
import { parseTrackList, startsOf } from './album-tracklist.js';
import { normalType } from './album-draft-model.js';
import { fold } from './album-candidates.js';
import { splitTokens } from './tokens.js';

export const STEPS = ['link', 'details', 'discogs', 'review', 'run'];
export const STEP_LABEL = { link: 'Link', details: 'Details', discogs: 'Discogs', review: 'Review', run: 'Import' };
export const MAX_PILLS = 4;
export const SOURCE_LABEL = { discogs: 'Discogs', wikipedia: 'Wikipedia', rym: 'Rate Your Music' };

export const EMPTY_MESSAGE = 'Paste a YouTube playlist or video address.';
export const NOT_YOUTUBE_MESSAGE = 'Add album takes a YouTube playlist or a video with time codes. Paste one of those.';
export const DISCOGS_HINT = 'Discogs fills the details after you add the YouTube link.';
export const OFFLINE_MESSAGE = 'You are offline. Adding an album needs the server.';
export const NO_TRACKS_TEXT = 'No tracks found in this text. Each line needs a time, like 03:45 Artist - Title.';
export const NO_TRACKLIST = 'No track list was found in this video. Paste it below.';

export function classifyAddress(text) {
  const address = String(text ?? '').trim();
  if (!address) return { ok: false, error: EMPTY_MESSAGE, hint: '' };
  const list = playlistLink(address);
  if (list?.kind === 'mix') return { ok: false, error: MIX_MESSAGE, hint: '' };
  if (list?.kind === 'private') return { ok: false, error: PRIVATE_MESSAGE, hint: '' };
  if (list) return { ok: true, kind: 'playlist', url: list.url };
  if (videoLink(address)) return { ok: true, kind: 'video', url: address };
  return { ok: false, error: NOT_YOUTUBE_MESSAGE, hint: /(?:^|[/.])discogs\.com/i.test(address) ? DISCOGS_HINT : '' };
}

const CODED = /^\s*[[(]?\d{1,2}(?::\d{2}){1,2}\s*[\])]?[\s.\-–—]/;

export function normalisePasted(text) {
  const raw = String(text ?? '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.filter((l) => CODED.test(l)).length >= 2) return { text: raw, converted: false };
  const parsed = parseTrackList(raw);
  if (parsed.tracks.length < 2 || parsed.tracks.some((t) => t.length === null)) return { text: raw, converted: false };
  const starts = startsOf(parsed.tracks);
  const out = parsed.tracks.map((t, i) => `${formatClock(starts[i])} ${t.artist ? `${t.artist} - ` : ''}${t.title}`).join('\n');
  return { text: out, converted: true };
}

export function newDraft() {
  return {
    step: 'link', address: '', url: '', kind: null, pasteText: '', needPaste: false,
    preview: null, st: null, base: null, fields: { artist: '', album: '', year: '' }, edited: false,
    discogs: { key: '', state: 'idle', all: false, candidates: [], error: '', pick: null, resolved: null, auto: false },
    review: null, art: { chosen: null },
    album: { type: 'album', genres: [], links: {} }, touched: { genres: false, type: false },
    genreHints: { key: '', state: 'idle', items: [], page: null, error: '' },
    rym: { url: '', text: '' },
  };
}

export function applyPreview(draft, kind, url, preview) {
  const st = kind === 'video' ? stateOf(preview, url) : playlistState(preview, url);
  const keep = { address: draft.address, pasteText: draft.pasteText, pastedUsed: draft.pastedUsed || '', needPaste: draft.needPaste };
  Object.assign(draft, newDraft(), keep, { kind, url, preview, st, step: 'details' });
  draft.base = { artist: st.album.albumArtist, album: st.album.title, year: st.album.year };
  draft.fields = { ...draft.base };
  draft.album = { type: normalType(st.album.type), genres: [...st.album.genres], links: { ...st.album.links } };
  draft.art.chosen = null;
  return draft;
}

export const needsRestart = (draft, address) => !!draft.preview && draft.edited && String(address).trim() !== draft.address;
export const sameSource = (draft, address) => !!draft.preview && String(address).trim() === draft.address;

export const artistName = (text) => splitTokens(text).join(' & ');

export const searchKey = (f) => [fold(artistName(f.artist)), fold(f.album), String(f.year || '').trim()].join('|');

const plain = (s) => fold(s).replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function fieldIssues(fields) {
  const out = [];
  if (!fields.album.trim()) out.push('Give the album a name.');
  if (!artistName(fields.artist)) out.push('Give the album an artist.');
  const year = fields.year.trim();
  if (year && !/^\d{4}$/.test(year)) out.push('Year must have four digits.');
  return out;
}

export function isConfident(candidates, fields) {
  const list = Array.isArray(candidates) ? candidates : [];
  const year = Number(fields.year) || 0;
  const exact = list.filter((c) => plain(c.artist) === plain(artistName(fields.artist)) && plain(c.title) === plain(fields.album)
    && (!year || !c.year || Math.abs(c.year - year) <= 1));
  return exact.length === 1 ? exact[0] : null;
}

export function afterStep(draft, step) {
  if (step === 'details') return draft.discogs.auto ? 'review' : 'discogs';
  return STEPS[STEPS.indexOf(step) + 1] || step;
}

export function beforeStep(draft, step) {
  if (step === 'review') return draft.discogs.auto ? 'details' : 'discogs';
  return STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
}

export const names = (c) => [...new Set([...(c?.styles || []), ...(c?.genres || [])].map((g) => String(g).trim()).filter(Boolean))];

export function discTracks(draft) {
  const t = draft.discogs.resolved?.tracks;
  return Array.isArray(t) ? t.filter((x) => Number.isInteger(x.no) && x.title) : [];
}

const fullKey = (s) => plain(s);
const baseKey = (s) => plain(String(s ?? '').replaceAll(/[([][^)\]]*[)\]]/g, ' '));

export function matchTracks(src, disc) {
  const out = new Map();
  const usedSrc = new Set();
  const pass = (test) => {
    for (const d of disc) {
      if (out.has(d.no)) continue;
      const hit = src.find((r) => !usedSrc.has(r.key) && test(r, d));
      if (hit) { out.set(d.no, hit.key); usedSrc.add(hit.key); }
    }
  };
  pass((r, d) => fullKey(`${r.title} ${r.version}`) === fullKey(d.title));
  pass((r, d) => fullKey(r.title) === fullKey(d.title));
  pass((r, d) => baseKey(r.title) && baseKey(r.title) === baseKey(d.title));
  pass((r, d) => baseKey(d.title).length >= 3 && baseKey(r.title).length >= 3 && (baseKey(r.title).includes(baseKey(d.title)) || baseKey(d.title).includes(baseKey(r.title))));
  if (!out.size && src.length === disc.length) disc.forEach((d, i) => out.set(d.no, src[i].key));
  return out;
}

const defaultInclude = (r) => !!r.include;

export function buildReview(draft) {
  const src = draft.st.rows;
  const disc = discTracks(draft);
  const assign = new Map();
  const matched = disc.length ? matchTracks(src, disc) : new Map();
  for (const d of disc) assign.set(d.no, matched.get(d.no) ?? null);
  const taken = new Set(matched.values());
  const state = new Map(src.map((r) => [r.key, { include: disc.length && !taken.has(r.key) ? false : defaultInclude(r), useExisting: false, useDisc: false }]));
  draft.review = { assign, state, disc };
  return draft.review;
}

export function reviewRows(draft) {
  const rv = draft.review;
  const byKey = new Map(draft.st.rows.map((r) => [r.key, r]));
  const rows = [];
  const used = new Set();
  for (const d of rv.disc) {
    const key = rv.assign.get(d.no) ?? null;
    if (key !== null) used.add(key);
    rows.push({ id: `d${d.no}`, disc: d, src: key === null ? null : byKey.get(key), st: key === null ? null : rv.state.get(key) });
  }
  for (const r of draft.st.rows) if (!used.has(r.key)) rows.push({ id: `s${r.key}`, disc: null, src: r, st: rv.state.get(r.key) });
  return rows;
}

export function reassign(draft, discNo, srcKey) {
  const rv = draft.review;
  const prev = rv.assign.get(discNo) ?? null;
  if (srcKey === prev) return;
  const wasAssigned = srcKey !== null && [...rv.assign.values()].includes(srcKey);
  if (srcKey !== null) {
    for (const [n, k] of rv.assign) if (n !== discNo && k === srcKey) rv.assign.set(n, prev);
    if (!wasAssigned) {
      const s = draft.st.rows.find((r) => r.key === srcKey);
      rv.state.get(srcKey).include = !s?.match;
    }
  }
  rv.assign.set(discNo, srcKey);
  if (prev !== null && ![...rv.assign.values()].includes(prev)) rv.state.get(prev).include = false;
}

export function estLength(draft, src) {
  if (!src) return null;
  if (draft.kind === 'playlist') return src.durationS || null;
  const i = draft.st.rows.indexOf(src);
  const len = endOf(draft.st, i) - src.start;
  return len > 0 ? len : null;
}

export function lengthGap(draft, row) {
  const est = estLength(draft, row.src);
  const want = row.disc?.durationS;
  return est && want ? Math.abs(est - want) : 0;
}

export const LENGTH_WARN_S = 20;

const isVarious = (name) => ['various', 'various artists', 'va'].includes(fold(name));

export function ownArtists(draft, r) {
  const text = String(r.artists || '').trim();
  return text && fold(text) !== fold(draft.base?.artist) ? text : '';
}

export function trackArtists(draft, r) {
  const own = ownArtists(draft, r);
  if (own) return own;
  const album = artistName(draft.fields.artist);
  return isVarious(album) ? '' : album;
}

export function linksNow(draft) {
  const links = { ...draft.album.links };
  const pick = draft.discogs.pick;
  if (pick && pick !== 'none' && pick.url) links.discogs = pick.url;
  if (draft.rym.url) links.rateyourmusic = draft.rym.url;
  if (!links.wikipedia && draft.genreHints.page) links.wikipedia = draft.genreHints.page;
  return links;
}

export function albumNow(draft) {
  return {
    title: draft.fields.album.trim(), albumArtist: artistName(draft.fields.artist), year: draft.fields.year.trim(), type: draft.album.type,
    genres: draft.album.genres, links: linksNow(draft), coverUrl: draft.art.chosen || null,
  };
}

export function reviewView(draft) {
  const rows = reviewRows(draft);
  const byKey = new Map(draft.st.rows.map((r) => [r.key, { ...r, include: false, useExisting: false }]));
  const top = Math.max(0, ...draft.review.disc.map((d) => d.no));
  const hasDisc = draft.review.disc.length > 0;
  let extra = top;
  let seq = 0;
  for (const row of rows) {
    const r = row.src ? byKey.get(row.src.key) : null;
    if (!r) continue;
    r.include = !!row.st.include;
    r.useExisting = !!row.st.useExisting && !!r.match;
    r.artists = trackArtists(draft, row.src);
    if (row.disc) {
      r.no = row.disc.no;
      if (row.st.useDisc || !r.title.trim()) { r.title = row.disc.title; r.version = ''; }
    } else if (hasDisc) {
      extra += 1;
      r.no = extra;
    }
  }
  if (!hasDisc) {
    for (const row of rows) {
      const r = byKey.get(row.src.key);
      if (r.include) { seq += 1; r.no = seq; }
    }
  }
  return { ...draft.st, album: albumNow(draft), rows: draft.st.rows.map((r) => byKey.get(r.key)) };
}

export function createIssues(draft) {
  const view = reviewView(draft);
  return draft.kind === 'video' ? videoIssues(view) : playlistIssues(view);
}

export function summaryText(draft) {
  const view = reviewView(draft);
  return draft.kind === 'video' ? videoSummary(view) : playlistSummary(view);
}

export function rowIssueFor(draft, view, src) {
  const i = draft.st.rows.indexOf(src);
  if (i < 0) return '';
  return draft.kind === 'video' ? videoRowIssue(view, i) : playlistRowIssue(view, i);
}

export function createPayload(draft) {
  const view = reviewView(draft);
  if (draft.kind === 'video') return { ...videoPayload(view), coverToSongs: true };
  const body = playlistPayload(view);
  const numbers = new Map(view.rows.map((r) => [r.position, r.no]));
  return { ...body, selected: body.selected.map((s) => ({ ...s, trackNo: numbers.get(s.position) })), coverToSongs: true };
}

export function artOptions(draft) {
  const out = [];
  const add = (url, source) => {
    if (typeof url === 'string' && url.startsWith('https://') && !out.some((o) => o.url === url)) out.push({ url, source, label: source === 'discogs' ? 'Discogs' : 'YouTube' });
  };
  const pick = draft.discogs.pick;
  add(draft.discogs.resolved?.cover, 'discogs');
  if (pick && pick !== 'none') add(pick.cover, 'discogs');
  const thumb = draft.preview?.thumbnail;
  add(thumb, 'youtube');
  const own = draft.preview?.album?.coverUrl;
  if (own && own === thumb) add(own, 'youtube');
  return out;
}

export function initialGenres(draft) {
  const items = draft.genreHints.items;
  const fromSource = (source) => items.filter((i) => i.source === source && i.mapped).map((i) => i.mapped);
  const picked = [...new Set([...fromSource('rym'), ...fromSource('discogs')])].slice(0, MAX_PILLS);
  return picked.length ? picked : draft.album.genres.slice(0, MAX_PILLS);
}

const RYM_HOST = /^https?:\/\/(?:www\.)?rateyourmusic\.com\/\S+$/i;

export function parseRym(text) {
  const value = String(text ?? '').trim();
  if (!value) return { url: '', genres: '' };
  if (RYM_HOST.test(value)) return { url: value.replace(/^http:/i, 'https:'), genres: '' };
  return { url: '', genres: value };
}

export function genresPayload(draft, rymText = '') {
  return {
    artist: artistName(draft.fields.artist), title: draft.fields.album.trim(), year: Number(draft.fields.year) || null,
    discogs: names(draft.discogs.resolved || (draft.discogs.pick !== 'none' ? draft.discogs.pick : null)),
    ...(rymText ? { rym: rymText } : {}),
  };
}

export function createLabel(draft) {
  if (draft.kind === 'video') return 'Download, cut and import';
  const fresh = reviewView(draft).rows.filter((r) => r.include && !r.songId).length;
  return fresh ? `Import and download ${fresh} ${fresh === 1 ? 'track' : 'tracks'}` : 'Import the album';
}

export const unreachable = (ex) => ex?.status === 0;

export function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
