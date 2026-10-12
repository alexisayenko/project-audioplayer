const YT = [
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/i,
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?#].*)?$/i,
  /^(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[/?#].*)?$/i,
];
const SC_USER_RESERVED = new Set(['discover', 'stations', 'you', 'charts', 'search', 'upload', 'feed', 'pages', 'popular', 'mobile', 'settings', 'notifications', 'messages', 'jobs', 'terms-of-use', 'creators', 'go']);
const SC_SECOND_RESERVED = new Set(['tracks', 'albums', 'sets', 'reposts', 'likes', 'spotlight', 'comments', 'popular-tracks', 'following', 'followers', 'playlists']);
const SC_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const TRACKING = new Set(['si', 'feature', 'pp', 'fbclid', 'gclid']);
const SP_HOSTS = new Set(['open.spotify.com', 'play.spotify.com']);
const SP_TRACK_ID = /^[A-Za-z0-9]{22}$/;

/** `{kind: 'track'|'short'|'unsupported', url}` for Spotify links, else null. Port of server/app/urlclean.py classify_spotify. */
export function classifySpotify(input) {
  const text = String(input ?? '').trim();
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/i.exec(text);
  if (uri) {
    return uri[1].toLowerCase() === 'track' && SP_TRACK_ID.test(uri[2])
      ? { kind: 'track', url: `https://open.spotify.com/track/${uri[2]}` }
      : { kind: 'unsupported', url: '' };
  }
  const m = /^(?:https?:\/\/)?([A-Za-z0-9.-]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(text);
  if (!m) return null;
  const host = m[1].toLowerCase();
  let parts = (m[2] || '').split('/').filter(Boolean);
  if (host === 'spotify.link') {
    return parts.length === 1 && /^[A-Za-z0-9]{3,32}$/.test(parts[0])
      ? { kind: 'short', url: `https://spotify.link/${parts[0]}` }
      : { kind: 'unsupported', url: '' };
  }
  if (!SP_HOSTS.has(host)) return null;
  if (parts.length && /^intl-[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(parts[0])) parts = parts.slice(1);
  if (parts.length === 2 && parts[0].toLowerCase() === 'track' && SP_TRACK_ID.test(parts[1])) {
    return { kind: 'track', url: `https://open.spotify.com/track/${parts[1]}` };
  }
  return { kind: 'unsupported', url: '' };
}

/** `{kind: 'track'|'short'|'unsupported', url}` for SoundCloud links, else null. Port of server/app/urlclean.py. */
export function classifySoundcloud(input) {
  const m = /^(?:https?:\/\/)?([A-Za-z0-9.-]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(String(input ?? '').trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const parts = (m[2] || '').split('/').filter(Boolean);
  if (host === 'on.soundcloud.com') {
    return parts.length === 1 && /^[A-Za-z0-9]{3,32}$/.test(parts[0])
      ? { kind: 'short', url: `https://on.soundcloud.com/${parts[0]}` }
      : { kind: 'unsupported', url: '' };
  }
  if (!SC_HOSTS.has(host)) return null;
  const unsupported = { kind: 'unsupported', url: '' };
  if (parts.length < 2 || parts.length > 3) return unsupported;
  const [user, track, secret] = parts;
  if (SC_USER_RESERVED.has(user.toLowerCase()) || SC_SECOND_RESERVED.has(track.toLowerCase())) return unsupported;
  if (!/^[A-Za-z0-9_-]+$/.test(user) || !/^[A-Za-z0-9_-]+$/.test(track)) return unsupported;
  let url = `https://soundcloud.com/${user}/${track}`;
  if (parts.length === 3) {
    if (!/^s-[A-Za-z0-9]+$/.test(secret)) return unsupported;
    url += `/${secret}`;
  }
  return { kind: 'track', url };
}

export function sourceOf(id) {
  const s = String(id ?? '');
  if (/^soundcloud-[0-9]{1,20}$/.test(s)) return 'soundcloud';
  if (/^spotify-[A-Za-z0-9]{22}$/.test(s)) return 'spotify';
  return 'youtube';
}

const LABELS = { soundcloud: 'SoundCloud', spotify: 'Spotify', youtube: 'YouTube' };
export const sourceLabel = (source) => LABELS[source] || 'YouTube';

export function cleanUrl(input) {
  const text = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return `https://www.youtube.com/watch?v=${text}`;
  for (const rx of YT) {
    const m = rx.exec(text);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  const sc = classifySoundcloud(text);
  if (sc && sc.kind !== 'unsupported') return sc.url;
  const sp = classifySpotify(text);
  if (sp && sp.kind !== 'unsupported') return sp.url;
  let u;
  try { u = new URL(text); } catch { return text; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return text;
  const hash = u.hash;
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.has(k.toLowerCase()) && !k.toLowerCase().startsWith('utm_'));
  u.search = new URLSearchParams(kept).toString();
  u.hash = hash;
  return u.href;
}

export function cleanPasted(input) {
  const text = String(input ?? '').trim();
  const uri = /spotify:track:[A-Za-z0-9]{22}/i.exec(text);
  if (uri) return cleanUrl(uri[0]);
  const found = /(?:https?:\/\/|(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)\/|(?:www\.|m\.)?soundcloud\.com\/|on\.soundcloud\.com\/|(?:open|play)\.spotify\.com\/|spotify\.link\/)[^\s<>"']+/i.exec(text);
  if (found) return cleanUrl(found[0]);
  return cleanUrl(text.split(/\s*[\r\n]+\s*/)[0]);
}
