import { fmtTime } from './dom.js';

export const lengthText = (s) => (Number.isFinite(s) && s >= 0 ? fmtTime(s) : '');

export const fold = (s) => String(s ?? '').normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();

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

export const QUOTA_PER_HOUR = 20;
