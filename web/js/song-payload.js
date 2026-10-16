import { MIN_YEAR, maxYear } from './constants.js';
import { joinNames } from './credits.js';

export const yearValue = (v) => (v === '' || v == null ? null : Number(v));

const yearOk = (n) => Number.isInteger(n) && n >= MIN_YEAR && n <= maxYear();
const yearKept = (raw, stored) => {
  const n = yearValue(raw);
  return n === null || yearOk(n) || n === stored;
};
const storedYears = (stored) => ({ released: stored?.released ?? stored?.year ?? null, version: stored?.version?.year ?? stored?.remix_year ?? null });

export const yearMessage = () => `Enter a year from ${MIN_YEAR} to ${maxYear()}`;

export function yearError(v, stored = {}) {
  const st = storedYears(stored);
  return yearKept(v.released, st.released) && yearKept(v.version?.year, st.version) ? null : yearMessage();
}

const sourceUrl = (s) => {
  if (typeof s === 'string') return s;
  return typeof s?.url === 'string' ? s.url : '';
};

export function sourceList(source) {
  let raw = [];
  if (Array.isArray(source)) raw = source;
  else if (source) raw = [source];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const url = sourceUrl(s);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }
  return out;
}

export const songSources = (song) => sourceList([...(Array.isArray(song?.sources) ? song.sources : []), song?.source_url]);

const names = (list) => (Array.isArray(list) ? list.map((n) => String(n ?? '').trim()).filter(Boolean) : []);
const text = (v) => String(v ?? '').trim() || null;

function versionOf(v, storedYear) {
  const ver = v.version;
  if (!ver || !ver.kind) return null;
  return {
    kind: ver.kind,
    name: text(ver.name),
    by: names(ver.by),
    year: yearKept(ver.year, storedYear) ? yearValue(ver.year) : null,
    ...(ver.kind === 'cover' ? { of: text(ver.of) } : {}),
  };
}

function songFields(v, stored = {}) {
  return {
    title: v.title,
    album: v.album,
    artists: names(v.artists),
    featured: names(v.featured),
    ...(yearKept(v.released, storedYears(stored).released) ? { released: yearValue(v.released) } : {}),
  };
}

const wikiFieldsOf = (v) => ({ wikipedia_song: v.wikipedia_song ?? null, wikipedia_artist: v.wikipedia_artist ?? null, wikipedia_album: v.wikipedia_album ?? null, musicbrainz_url: v.musicbrainz_url ?? null, discogs_url: v.discogs_url ?? null, spotify_url: v.spotify_url ?? null });

const HOST_RX = { youtube: /^https?:\/\/(?:[a-z]+\.)?(?:youtube\.com|youtu\.be)\//i, soundcloud: /^https?:\/\/(?:[a-z]+\.)?soundcloud\.com\//i };

function sourceLinkChanges(v, stored) {
  const sources = songSources(stored).map((e) => e.url);
  const out = {};
  for (const kind of ['youtube', 'soundcloud']) {
    const now = (v[`${kind}_url`] ?? '').trim();
    if (v[`${kind}_url`] !== undefined && now !== (sources.find((u) => HOST_RX[kind].test(u)) ?? '')) out[`${kind}_url`] = now || null;
  }
  return out;
}

export function addBody(v) {
  const version = versionOf(v, null);
  return { ...songFields(v), ...(version ? { version } : {}), ...wikiFieldsOf(v) };
}

export function patchBody(v, stored = {}) {
  return { ...songFields(v, stored), version: versionOf(v, storedYears(stored).version), tags: v.tags, ...wikiFieldsOf(v), ...sourceLinkChanges(v, stored) };
}


export function artistString(v) {
  const main = joinNames(names(v.artists));
  const feat = joinNames(names(v.featured));
  return feat ? `${main} feat. ${feat}`.trim() : main;
}

export function metadataBody(v, sources) {
  return {
    title: String(v.title ?? '').trim(),
    artist: typeof v.artist === 'string' ? v.artist.trim() : artistString(v),
    ...(v.version?.kind ? { version_kind: v.version.kind } : {}),
    sources: sourceList(sources),
    ...(v.wikipedia_song ? { wiki_song: v.wikipedia_song } : {}),
    ...(v.wikipedia_artist ? { wiki_artist: v.wikipedia_artist } : {}),
    ...(v.wikipedia_album ? { wiki_album: v.wikipedia_album } : {}),
  };
}
