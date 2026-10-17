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
  const al = httpsUrl(song?.wikipedia_album);
  if (al) return { url: al, label: 'Wikipedia (album)' };
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
  const sp = httpUrl(song?.spotify_url);
  if (sp) out.spotify = { on: true, url: sp };
  return out;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const SC_NAME = /^[A-Za-z0-9_-]+$/;
const SC_RESERVED = new Set(['discover', 'stations', 'you', 'charts', 'search', 'upload', 'feed', 'pages', 'popular', 'mobile', 'settings', 'notifications', 'messages', 'jobs', 'terms-of-use', 'creators', 'go']);
const SP_ID = /^[A-Za-z0-9]{22}$/;

const parsed = (v) => {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
};

const youtubeOk = (u) => {
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return YT_ID.test(u.pathname.split('/')[1] || '');
  if (host !== 'youtube.com') return false;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return YT_ID.test(u.searchParams.get('v') || '');
  return ['shorts', 'embed', 'live'].includes(parts[0]) && YT_ID.test(parts[1] || '');
};

const soundcloudOk = (u) => {
  if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(u.hostname.toLowerCase())) return false;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  if (SC_RESERVED.has(parts[0].toLowerCase()) || !SC_NAME.test(parts[0]) || !SC_NAME.test(parts[1])) return false;
  return parts.length === 2 || /^s-[A-Za-z0-9]+$/.test(parts[2]);
};

const spotifyOk = (u) => {
  if (u.hostname.toLowerCase() !== 'open.spotify.com') return false;
  const parts = u.pathname.split('/').filter(Boolean);
  if (/^intl-[a-z]{2}/i.test(parts[0] || '')) parts.shift();
  return (parts[0] === 'track' || parts[0] === 'album') && SP_ID.test(parts[1] || '');
};

const LINK_CHECKS = {
  youtube: [youtubeOk, 'Use a YouTube link: https://www.youtube.com/watch?v=... or https://youtu.be/...'],
  soundcloud: [soundcloudOk, 'Use a SoundCloud track link: https://soundcloud.com/artist/track'],
  spotify: [spotifyOk, 'Use a Spotify track or album link: https://open.spotify.com/track/...'],
};

export function linkError(kind, value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const [ok, msg] = LINK_CHECKS[kind];
  const u = parsed(text);
  return u && ok(u) ? null : msg;
}

export function linkErrors(values, { ownKind = null } = {}) {
  const out = {};
  for (const kind of Object.keys(LINK_CHECKS)) {
    const v = values[kind];
    const bad = linkError(kind, v);
    if (bad) out[kind] = bad;
    else if (kind === ownKind && !String(v ?? '').trim()) out[kind] = 'This is the link the song\'s audio comes from; edit it instead of clearing it';
  }
  return out;
}

export const ownSourceKind = (song) => {
  const id = String(song?.id ?? '');
  if (id.startsWith('soundcloud-')) return 'soundcloud';
  if (/^(spotify|applemusic|shazam)-/.test(id)) return null;
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? 'youtube' : null;
};
