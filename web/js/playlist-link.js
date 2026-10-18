const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const LIST_ID = /^[A-Za-z0-9_-]{2,80}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PRIVATE_LISTS = new Set(['WL', 'LL']);

export const MIX_MESSAGE = 'This is a YouTube Mix (an automatic radio list), not a playlist. Open a real playlist and paste its link.';
export const PRIVATE_MESSAGE = 'Liked videos and Watch later are private lists. Put the songs in a public or unlisted playlist and paste that link.';

function parse(text) {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

function trimSlashes(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
}

function videoOf(u, host, path) {
  if (HOSTS.has(host)) return path === '/playlist' || path === '/watch' ? u.searchParams.get('v') : undefined;
  if (host === 'youtu.be' && path.length > 1) return path.slice(1).split('/')[0];
  return undefined;
}

/** `{kind: 'playlist'|'mix'|'private', id, video, url}` for a YouTube link that names a list, else null. Port of urlclean.parse_playlist; a video link taken from a Mix is a plain video (null). */
export function playlistLink(input) {
  const text = String(input ?? '').trim();
  const u = text ? parse(text) : null;
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const path = trimSlashes(u.pathname);
  const video = videoOf(u, host, path);
  if (video === undefined) return null;
  const id = u.searchParams.get('list') ?? '';
  if (!LIST_ID.test(id)) return null;
  const clip = video && VIDEO_ID.test(video) ? video : null;
  if (id.startsWith('RD')) return clip ? null : { kind: 'mix', id, video: null, url: '' };
  const kind = PRIVATE_LISTS.has(id) ? 'private' : 'playlist';
  return { kind, id, video: clip, url: `https://www.youtube.com/playlist?list=${id}` };
}

export const watchUrl = (video) => `https://www.youtube.com/watch?v=${video}`;
