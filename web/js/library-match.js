import { cleanPasted, classifySoundcloud } from './url-clean.js';

const YT_ID = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;

/** `{kind: 'youtube'|'soundcloud', key}` for a pasted link, else null. No network. */
export function linkKey(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const clean = cleanPasted(text);
  const yt = YT_ID.exec(clean);
  if (yt) return { kind: 'youtube', key: yt[1] };
  const sc = classifySoundcloud(clean);
  if (sc && sc.kind === 'track') return { kind: 'soundcloud', key: sc.url.toLowerCase() };
  return null;
}

/** The library song whose id or source link equals the pasted link, else null. */
export function findInLibrary(input, songs) {
  const k = linkKey(input);
  if (!k) return null;
  for (const s of songs || []) {
    if (k.kind === 'youtube' && s.id === k.key) return s;
    const list = Array.isArray(s.sources) ? s.sources : [];
    for (const src of list) {
      const other = src && linkKey(src.url);
      if (other && other.kind === k.kind && other.key === k.key) return s;
    }
  }
  return null;
}
