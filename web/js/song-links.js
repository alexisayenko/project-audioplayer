import { songSources } from './song-payload.js';

const HOSTS = {
  youtube: ['youtube.com', 'youtu.be'],
  soundcloud: ['soundcloud.com'],
  spotify: ['open.spotify.com'],
};

const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);

export function hostKind(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [kind, names] of Object.entries(HOSTS)) {
    if (names.some((n) => host === n || host.endsWith(`.${n}`))) return kind;
  }
  return null;
}

export function wikipediaLink(song) {
  const s = httpsUrl(song?.wikipedia_song);
  if (s) return { url: s, label: 'Wikipedia (song)' };
  const a = httpsUrl(song?.wikipedia_artist);
  return a ? { url: a, label: 'Wikipedia (artist)' } : null;
}

export function storedLinkStates(song) {
  const out = {};
  for (const { url } of songSources(song)) {
    const clean = httpUrl(url);
    const kind = clean ? hostKind(clean) : null;
    if (kind && !out[kind]) out[kind] = { on: true, url: clean };
  }
  const wiki = wikipediaLink(song);
  if (wiki) out.wikipedia = { on: true, url: wiki.url, label: wiki.label };
  const mb = httpUrl(song?.musicbrainz_url);
  if (mb) out.musicbrainz = { on: true, url: mb };
  const dc = httpUrl(song?.discogs_url);
  if (dc) out.discogs = { on: true, url: dc };
  return out;
}
