import { MIN_YEAR, maxYear } from './constants.js';
import { joinNames } from './credits.js';
import { cleanLabels, sameLabels } from './label-names.js';

export const yearValue = (v) => (v === '' || v == null ? null : Number(v));

const yearOk = (n) => Number.isInteger(n) && n >= MIN_YEAR && n <= maxYear();
const yearKept = (raw, stored) => {
  const n = yearValue(raw);
  return n === null || yearOk(n) || n === stored;
};
const storedYears = (stored) => ({ released: stored?.releaseYear ?? stored?.year ?? null, version: stored?.version?.releaseYear ?? stored?.remix_year ?? null });

export const yearMessage = () => `Enter a year from ${MIN_YEAR} to ${maxYear()}`;

export function yearError(v, stored = {}) {
  const st = storedYears(stored);
  return yearKept(v.releaseYear, st.released) && yearKept(v.version?.releaseYear, st.version) ? null : yearMessage();
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
function ofNames(v) {
  if (Array.isArray(v)) return names(v);
  const one = text(v);
  return one ? [one] : [];
}

function versionOf(v, storedYear) {
  const ver = v.version;
  if (!ver?.type) return null;
  return {
    type: ver.type,
    name: text(ver.name),
    artists: names(ver.artists),
    releaseYear: yearKept(ver.releaseYear, storedYear) ? yearValue(ver.releaseYear) : null,
    ...(ver.type === 'cover' || ver.type === 'mashup' ? { originalArtists: ofNames(ver.originalArtists) } : {}),
  };
}

function songFields(v, stored = {}) {
  return {
    title: v.title,
    albums: names(v.albums),
    mainArtists: names(v.mainArtists),
    featuredArtists: names(v.featuredArtists),
    withArtists: names(v.withArtists),
    ...(yearKept(v.releaseYear, storedYears(stored).released) ? { releaseYear: yearValue(v.releaseYear) } : {}),
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

export const storedTags = (tags) => (Array.isArray(tags) ? tags.filter((t) => !/^(decade|lang):/i.test(t)) : tags);

export const genresOf = (tags) => (Array.isArray(tags) ? tags.filter((t) => /^genre:/i.test(t)).map((t) => t.slice(6).trim()).filter(Boolean) : []);
export const otherTags = (tags) => (Array.isArray(tags) ? tags.filter((t) => !/^(genre|decade|lang):/i.test(t)) : []);

const labelChange = (v, stored) => (v.labels === undefined || sameLabels(v.labels, stored?.labels) ? {} : { labels: cleanLabels(v.labels) });

export function patchBody(v, stored = {}) {
  return { ...songFields(v, stored), version: versionOf(v, storedYears(stored).version), genres: genresOf(v.tags), tags: otherTags(v.tags), ...wikiFieldsOf(v), ...sourceLinkChanges(v, stored), ...labelChange(v, stored) };
}


export function artistString(v) {
  const main = joinNames(names(v.mainArtists));
  const feat = joinNames(names(v.featuredArtists));
  const withs = joinNames(names(v.withArtists));
  return [main, feat && `feat. ${feat}`, withs && `with ${withs}`].filter(Boolean).join(' ');
}

export function metadataBody(v, sources) {
  return {
    title: String(v.title ?? '').trim(),
    artist: typeof v.artist === 'string' ? v.artist.trim() : artistString(v),
    ...(v.version?.type ? { version_kind: v.version.type } : {}),
    sources: sourceList(sources),
    ...(v.wikipedia_song ? { wiki_song: v.wikipedia_song } : {}),
    ...(v.wikipedia_artist ? { wiki_artist: v.wikipedia_artist } : {}),
    ...(v.wikipedia_album ? { wiki_album: v.wikipedia_album } : {}),
    ...(v.discogs_url && !v.version?.type ? { discogs_url: v.discogs_url } : {}),
  };
}
