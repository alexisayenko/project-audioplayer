export const NOT_DISCOGS_LINK = 'This is not a Discogs release or master link.';

const WEB_PATH = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(release|master)\/(?:view\/)?(\d+)(?:[-/].*)?$/;
const API_PATH = /^\/(releases|masters)\/(\d+)\/?$/;
const SHORT = /^([rm])(\d+)$/i;
const BARE_HOST = /^(?:www\.|api\.)?discogs\.com(?:[/?#]|$)/i;

const found = (kind, digits) => {
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 ? { ok: true, kind, id } : { ok: false, error: NOT_DISCOGS_LINK };
};

export function parseDiscogsLink(text) {
  const raw = String(text ?? '').trim();
  const short = SHORT.exec(raw);
  if (short) return found(short[1].toLowerCase() === 'm' ? 'master' : 'release', short[2]);
  let url;
  try {
    url = new URL(BARE_HOST.test(raw) ? `https://${raw}` : raw);
  } catch {
    return { ok: false, error: NOT_DISCOGS_LINK };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: NOT_DISCOGS_LINK };
  const host = url.hostname.toLowerCase();
  if (host === 'discogs.com' || host === 'www.discogs.com') {
    const m = WEB_PATH.exec(url.pathname);
    return m ? found(m[1], m[2]) : { ok: false, error: NOT_DISCOGS_LINK };
  }
  if (host === 'api.discogs.com') {
    const m = API_PATH.exec(url.pathname);
    return m ? found(m[1] === 'masters' ? 'master' : 'release', m[2]) : { ok: false, error: NOT_DISCOGS_LINK };
  }
  return { ok: false, error: NOT_DISCOGS_LINK };
}

export const LINK_ERRORS = {
  discogs_unavailable: 'Discogs is not set up on this server.',
  discogs_not_found: 'Discogs has no album at this link.',
  discogs_failed: 'Discogs did not answer, try again.',
};
