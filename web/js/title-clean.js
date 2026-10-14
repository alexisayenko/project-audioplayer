// Twin of server/app/titleclean.py; both are driven by server/tests/fixtures/title_clean_cases.json. Change them together.
const NOISE = [
  'free download', 'free dl', 'free d/l', 'free dl!', 'download', 'free', 'free track', 'free release', 'premiere', 'premiered',
  'exclusive', 'out now', 'out soon', 'available now', 'buy', 'buy now', 'hd', 'hq', '4k', '1080p', '720p', '60fps', 'official',
  'official video', 'official music video', 'official audio', 'official lyric video', 'official visualizer', 'official video clip',
  'lyrics', 'lyric video', 'with lyrics', 'video', 'audio', 'visualizer', 'music video', 'mv', 'clip', 'video clip', 'full song',
  'full version', 'high quality', 'hq audio',
];
const PROMO = ['free download', 'free dl', 'free d/l', 'free dl!', 'out now', 'premiere'];

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const NOISE_SET = new Set(NOISE.map(norm));
const PROMO_SET = new Set(PROMO.map(norm));
const GROUP = /[(\[{【][^()\[\]{}【】]*[)\]}】]/g;
const SEG = /(\s+(?:\||｜|\/\/|\/|／|-|–|—)\s+)/;
const TAIL = /[\s|/\-–—]+$/;
const HEAD = /^[\s|/\-–—]+/;
const ws = (s) => s.replace(/\s+/g, ' ');

function isNoise(text, allowed = NOISE_SET) {
  const whole = norm(text);
  if (!whole) return false;
  if (allowed.has(whole)) return true;
  const parts = text.split(/[/,&+]/).map(norm).filter(Boolean);
  return parts.length > 1 && parts.every((p) => allowed.has(p));
}

export function cleanTitleEx(title) {
  const original = ws(String(title ?? '')).trim();
  let s = String(title ?? '');
  const removed = [];
  for (;;) {
    const before = s;
    let changed = true;
    while (changed) {
      changed = false;
      s = s.replace(GROUP, (m) => {
        if (isNoise(m.slice(1, -1))) {
          removed.push(ws(m));
          changed = true;
          return ' ';
        }
        return m;
      });
    }
    if (s !== before) s = ws(s).trim().replace(TAIL, '').replace(HEAD, '');
    let parts = s.split(SEG);
    while (parts.length >= 3) {
      const sep = parts[parts.length - 2].trim();
      const allowed = !['-', '–', '—'].includes(sep) || parts.length >= 5 ? NOISE_SET : PROMO_SET;
      if (!isNoise(parts[parts.length - 1], allowed)) break;
      removed.push(parts[parts.length - 1].trim());
      parts = parts.slice(0, -2);
    }
    const joined = parts.join('');
    if (joined !== s) s = joined.replace(TAIL, '');
    s = ws(s).trim();
    if (s === before.trim() || s === ws(before).trim()) break;
  }
  if (!s) return { title: original, removed: [] };
  return { title: s, removed };
}

export const cleanTitle = (title) => cleanTitleEx(title).title;
