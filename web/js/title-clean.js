// Twin of server/app/titleclean.py; both are driven by server/tests/fixtures/title_clean_cases.json. Change them together.
const NOISE = [
  'free download', 'free dl', 'free d/l', 'free dl!', 'download', 'free', 'free track', 'free release', 'premiere', 'premiered',
  'exclusive', 'out now', 'out soon', 'available now', 'buy', 'buy now', 'hd', 'hq', '4k', '1080p', '720p', '60fps', 'official',
  'official video', 'official music video', 'official audio', 'official lyric video', 'official visualizer', 'official video clip',
  'lyrics', 'lyric video', 'with lyrics', 'video', 'audio', 'visualizer', 'music video', 'mv', 'clip', 'video clip', 'full song',
  'full version', 'high quality', 'hq audio', 'original mix', 'original version', 'original',
];
const WORDS = new Set(('free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv audio video ' +
  'music clip with out now soon available buy new full song high quality the').split(' '));
const STRONG = new Set('free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv video audio clip'.split(' '));
const PROMO = ['free download', 'free dl', 'free d/l', 'free dl!', 'out now', 'premiere'];
const USE_NOTE_WORDS = ['soundtrack', 'ost', 'original soundtrack', 'score'];
const USE_NOTE_LEADS = ['from', 'theme from', 'music from'];

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const NOISE_SET = new Set(NOISE.map(norm));
const PROMO_SET = new Set(PROMO.map(norm));
const alt = (list) => list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const USE_NOTE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alt(USE_NOTE_WORDS)})(?![\\p{L}\\p{N}_])|^\\s*(?:${alt(USE_NOTE_LEADS)})\\s`, 'iu');
const TAIL_GROUP = /[([]([^()[\]]*)[)\]]$/;
const GROUP = /[([{【][^()[\]{}【】]*[)\]}】]/g;
const SEG = /((?<!\s)\s+(?:\||｜|\/\/|\/|／|-|–|—)\s+)/;
const TRIM_EXTRA = '|/-–—';
const isTrimChar = (ch) => TRIM_EXTRA.includes(ch) || /\s/.test(ch);
const trimTail = (s) => {
  let end = s.length;
  while (end > 0 && isTrimChar(s[end - 1])) end -= 1;
  return s.slice(0, end);
};
const trimHead = (s) => {
  let start = 0;
  while (start < s.length && isTrimChar(s[start])) start += 1;
  return s.slice(start);
};
const ws = (s) => s.replace(/\s+/g, ' ');

function isNoise(text, allowed = NOISE_SET) {
  const whole = norm(text);
  if (!whole) return false;
  if (allowed.has(whole)) return true;
  const parts = text.split(/[/,&+]/).map(norm).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => allowed.has(p))) return true;
  if (allowed !== NOISE_SET) return false;
  const words = whole.split(' ');
  return words.every((w) => WORDS.has(w)) && words.some((w) => STRONG.has(w));
}

const RELEASE_KEEP = new Set('cover covers remix remixed mashup mix mixed edit'.split(' '));

function isReleaseTag(text) {
  const words = norm(text).split(' ').filter(Boolean);
  return words.length > 1 && words.at(-1) === 'release' && !words.some((w) => RELEASE_KEEP.has(w));
}

function stripNoiseGroups(text, removed) {
  let s = text;
  let changed = true;
  while (changed) {
    changed = false;
    s = s.replace(GROUP, (m) => {
      if (isNoise(m.slice(1, -1)) || isReleaseTag(m.slice(1, -1))) {
        removed.push(ws(m));
        changed = true;
        return ' ';
      }
      return m;
    });
  }
  return s;
}

export const isUseNote = (text) => USE_NOTE.test(text);

export function dropUseNotes(text, removed = null) {
  let s = text;
  for (;;) {
    const base = s.trimEnd();
    const m = TAIL_GROUP.exec(base);
    if (!m || !isUseNote(m[1])) return s;
    const head = trimTail(base.slice(0, m.index));
    if (!head.trim()) return s;
    if (removed) removed.push(ws(m[0]));
    s = head;
  }
}

function stripTrailingSegments(text, removed) {
  let parts = text.split(SEG);
  while (parts.length >= 3) {
    const sep = parts.at(-2).trim();
    const allowed = !['-', '–', '—'].includes(sep) || parts.length >= 5 ? NOISE_SET : PROMO_SET;
    if (!isNoise(parts.at(-1), allowed)) break;
    removed.push(parts.at(-1).trim());
    parts = parts.slice(0, -2);
  }
  return parts.join('');
}

export function cleanTitleEx(title) {
  const original = ws(String(title ?? '')).trim();
  let s = String(title ?? '');
  const removed = [];
  for (;;) {
    const before = s;
    s = stripNoiseGroups(s, removed);
    if (s !== before) s = trimHead(trimTail(ws(s).trim()));
    const joined = stripTrailingSegments(s, removed);
    if (joined !== s) s = trimTail(joined);
    s = dropUseNotes(s, removed);
    s = ws(s).trim();
    if (s === before.trim() || s === ws(before).trim()) break;
  }
  if (!s) return { title: original, removed: [] };
  return { title: s, removed };
}

export const cleanTitle = (title) => cleanTitleEx(title).title;
