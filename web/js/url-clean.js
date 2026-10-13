const YT = [
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:.*&)?v=([a-z0-9_-]{11})(?:[&#].*)?$/i,
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/(?:shorts|embed|live)\/([a-z0-9_-]{11})(?:[/?#].*)?$/i,
  /^(?:https?:\/\/)?youtu\.be\/([a-z0-9_-]{11})(?:[/?#].*)?$/i,
];
const SC_USER_RESERVED = new Set(['discover', 'stations', 'you', 'charts', 'search', 'upload', 'feed', 'pages', 'popular', 'mobile', 'settings', 'notifications', 'messages', 'jobs', 'terms-of-use', 'creators', 'go']);
const SC_SECOND_RESERVED = new Set(['tracks', 'albums', 'sets', 'reposts', 'likes', 'spotlight', 'comments', 'popular-tracks', 'following', 'followers', 'playlists']);
const SC_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const TRACKING = new Set(['si', 'feature', 'pp', 'fbclid', 'gclid']);

/** `{kind: 'track'|'short'|'unsupported', url}` for SoundCloud links, else null. Port of server/app/urlclean.py. */
export function classifySoundcloud(input) {
  const m = /^(?:https?:\/\/)?([a-z0-9.-]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(String(input ?? '').trim());
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
  const url = soundcloudTrackUrl(parts);
  return url ? { kind: 'track', url } : unsupported;
}

function soundcloudTrackUrl([user, track, secret]) {
  if (SC_USER_RESERVED.has(user.toLowerCase()) || SC_SECOND_RESERVED.has(track.toLowerCase())) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(user) || !/^[A-Za-z0-9_-]+$/.test(track)) return '';
  const url = `https://soundcloud.com/${user}/${track}`;
  if (secret === undefined) return url;
  return /^s-[A-Za-z0-9]+$/.test(secret) ? `${url}/${secret}` : '';
}

export function sourceOf(id) {
  return /^soundcloud-\d{1,20}$/.test(String(id ?? '')) ? 'soundcloud' : 'youtube';
}

export const sourceLabel = (source) => (source === 'soundcloud' ? 'SoundCloud' : 'YouTube');

export function cleanUrl(input) {
  const text = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return `https://www.youtube.com/watch?v=${text}`;
  for (const rx of YT) {
    const m = rx.exec(text);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  const sc = classifySoundcloud(text);
  if (sc && sc.kind !== 'unsupported') return sc.url;
  let u;
  try { u = new URL(text); } catch { return text; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return text;
  const hash = u.hash;
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.has(k.toLowerCase()) && !k.toLowerCase().startsWith('utm_'));
  u.search = new URLSearchParams(kept).toString();
  u.hash = hash;
  return u.href;
}

const ABSOLUTE_URL = /https?:\/\/[^\s<>"']+/i;
const YOUTUBE_URL = /(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)\/[^\s<>"']+/i;
const SOUNDCLOUD_URL = /(?:www\.|m\.|on\.)?soundcloud\.com\/[^\s<>"']+/i;

function firstMatch(text, patterns) {
  let best = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best?.[0];
}

export function cleanPasted(input) {
  const text = String(input ?? '').trim();
  const found = firstMatch(text, [ABSOLUTE_URL, YOUTUBE_URL, SOUNDCLOUD_URL]);
  if (found) return cleanUrl(found);
  return cleanUrl(text.split(/\s*[\r\n]+\s*/)[0]);
}
