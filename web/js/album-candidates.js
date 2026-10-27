import { el, fmtTime, plural } from './dom.js';
import { icon } from './icons.js';

export const lengthText = (s) => (Number.isFinite(s) && s >= 0 ? fmtTime(s) : '');

export const fold = (s) => String(s ?? '').normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();

export function fetchErrorText(ex) {
  if (ex.status === 400 || ex.code === 'bad_url') return 'This is not a Discogs release link. Paste an address like discogs.com/release/545650-Derango-Tumult.';
  if (ex.status === 404 || ex.code === 'not_found') return 'Discogs has no release at this address.';
  if (ex.status === 503 || ex.code === 'discogs_unavailable') return 'Discogs is not available right now. Try again later.';
  return ex.message || 'The release could not be fetched.';
}

export function matchMark(c, m) {
  if (!c) return null;
  if (m) return el('span', { class: 'album-match t-caption' }, `→ ${m.no}. ${m.title}`);
  return el('span', { class: 'album-match album-nomatch muted t-caption' }, 'no match');
}

export function searchErrorText(code) {
  if (!code) return '';
  return code === 'discogs_unavailable' ? 'Discogs is not available right now.' : 'The Discogs search failed.';
}

export const ALBUMS_CHANGED = 'albums-changed';

export const countOfList = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);

export function errorCode(ex) {
  const d = ex?.data?.detail;
  return ex?.code || (typeof d === 'string' ? d : d?.code) || '';
}

export function youtubeErrorText(ex) {
  const code = errorCode(ex);
  if (code === 'library_full_songs') return 'Your library is full. Remove some songs and try again.';
  if (code === 'bad_selection' || code === 'bad_mapping' || code === 'bad_album') return 'The selection could not be saved. Reload the playlist and try again.';
  if (ex.status === 400 || ex.code === 'bad_url') return 'This is not a valid YouTube playlist link.';
  if (ex.status === 404 || code === 'not_found') return 'YouTube has no playlist at this address, or it is private.';
  if (ex.status === 502 || code === 'youtube_failed') return 'YouTube could not be read right now. Try again later.';
  return ex.message || 'The playlist could not be read.';
}

export const list = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

export function candidateLines(c) {
  const head = [c.artist, c.title].filter(Boolean).join(' - ');
  const tracks = c.trackCount ? `${c.trackCount} ${plural(c.trackCount, 'track', 'tracks')}` : '';
  const sub = [c.year, tracks].filter(Boolean).join(' · ');
  const labels = list(c.labels).join(', ');
  const catnoText = c.catno ? String(c.catno) : '';
  const catnoSuffix = catnoText ? ` (${c.catno})` : '';
  const label = labels ? `${labels}${catnoSuffix}` : catnoText;
  const meta = [list(c.formats).join(', '), label, c.country].filter(Boolean).join(' · ');
  return { head, sub, meta };
}

export function candidateBody(c) {
  const { head, sub, meta } = candidateLines(c);
  const art = el('span', { class: 'row-cover album-cand-cover' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')));
  if (typeof c.thumb === 'string' && /^https?:\/\//i.test(c.thumb)) {
    const img = el('img', { class: 'cover', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: c.thumb });
    img.addEventListener('error', () => img.remove());
    art.append(img);
  }
  return [art,
    el('span', { class: 'info album-cand-text' },
      el('span', { class: 'album-cand-head' },
        el('span', { class: 'album-cand-title t-headline' }, head),
        c.best ? el('span', { class: 'chip tint album-best' }, 'Best match') : null),
      sub ? el('span', { class: 'album-cand-sub muted t-caption' }, sub) : null,
      meta ? el('span', { class: 'album-cand-meta muted t-caption' }, meta) : null)];
}

export function candidateRow(c, onPick) {
  const { head, sub, meta } = candidateLines(c);
  return el('button', { class: 'pl-pick-item album-cand', type: 'button', title: [head, sub, meta].filter(Boolean).join('\n'), onclick: onPick }, ...candidateBody(c));
}

export function matchMap(c) {
  const m = new Map();
  const raw = c?.matches && typeof c.matches === 'object' && !Array.isArray(c.matches) ? c.matches : {};
  const titles = new Map((Array.isArray(c?.tracks) ? c.tracks : []).map((t) => [t.no, t.title]));
  for (const [key, no] of Object.entries(raw)) {
    const pos = Number(key);
    if (Number.isInteger(pos) && Number.isInteger(no)) m.set(pos, { position: pos, no, title: titles.get(no) || '' });
  }
  return m;
}

export function autoMatch(tracks, candTracks) {
  const ct = Array.isArray(candTracks) ? candTracks : [];
  const used = new Set();
  const out = {};
  for (const t of tracks) {
    const hit = ct.find((x) => !used.has(x.no) && fold(x.title) === fold(t.title));
    if (hit) { used.add(hit.no); out[t.position] = hit.no; }
  }
  for (const t of tracks) {
    if (t.position in out) continue;
    const ft = fold(t.title);
    const hit = ct.find((x) => !used.has(x.no) && fold(x.title).length >= 3 && ft.includes(fold(x.title)));
    if (hit) { used.add(hit.no); out[t.position] = hit.no; }
  }
  if (!Object.keys(out).length && ct.length === tracks.length) tracks.forEach((t, i) => { out[t.position] = ct[i].no; });
  return out;
}

export function candidatePayload(c, playlistUrl) {
  return {
    title: c.title, artist: c.artist, year: c.year ?? null, genres: list(c.genres),
    ...(c.source && typeof c.source === 'object' ? { source: c.source } : {}),
    ...(Number.isInteger(c.discogsId) ? { discogsId: c.discogsId } : {}),
    tracks: Array.isArray(c.tracks) ? c.tracks : [],
    links: { ...c.links, discogs: c.url, youtube: playlistUrl },
  };
}

export const QUOTA_PER_HOUR = 20;
