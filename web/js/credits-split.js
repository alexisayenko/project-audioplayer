import { splitTokens } from './tokens.js';

const FEAT_KEY = /\b(?:featuring|feat\.?|ft\.?)\s/i;
const FEAT_STOPS = [' - ', ' – ', ' — ', ' | ', ' ●● ', ' • ', ')', ']', '(', '['];
const CLOSERS = { '(': ')', '[': ']' };
const SPLIT = /\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+vs\.?\s+/i;
const KIND_WORDS = [
  ['remix', /\bremix(?:ed)?\b|\bmashup\b|\bbootleg\b|\brework\b|\bvip\b/i],
  ['live', /\blive\b|\bunplugged\b|\bin concert\b/i],
  ['acoustic', /\bacoustic\b/i],
  ['extended', /\bextended\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['remaster', /\bremaster(?:ed)?\b/i],
  ['edit', /\bedit\b/i],
  ['cover', /\bcover\b/i],
];
const BY_STRIP = /\b(?:remix(?:ed)?|mix(?:ed)?|edit|mashup|bootleg|rework|vip|dub|version|radio|club|extended|original|instrumental|vocal|chill|by)\b/gi;
const MIXED_BY = /\bmixed\s+by\b/i;
const REMIX_OR_MASHUP = /\bremix\b|\bmashup\b/i;
const REMIX_WORD = /\bremix\b|\bmashup\b|\bmixed\s+by\b/i;
const BRACKET = /[([]([^)\]]*)[)\]]/g;
const SEGMENT_SPLIT = /( \| | - | – | — )/;
const PUNCT = new Set([' ', '-', '|']);

function stripSet(text, set) {
  let a = 0;
  let b = text.length;
  while (a < b && set.has(text[a])) a += 1;
  while (b > a && set.has(text[b - 1])) b -= 1;
  return text.slice(a, b);
}

const squash = (text) => stripSet(String(text ?? '').replace(/\s+/g, ' '), PUNCT);

function names(text) {
  const out = [];
  const seen = new Set();
  for (const part of squash(text).split(SPLIT)) {
    const name = stripSet(part ?? '', PUNCT);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

function featEnd(text, start) {
  const ends = FEAT_STOPS.map((s) => text.indexOf(s, start)).filter((i) => i >= 0);
  return ends.length ? Math.min(...ends) : text.length;
}

function cutFeat(input) {
  let text = input;
  const found = [];
  for (;;) {
    const m = FEAT_KEY.exec(text);
    if (!m) return [squash(text), found];
    const i = m.index;
    const end = i + m[0].length;
    const opener = i ? text[i - 1] : '';
    if (CLOSERS[opener]) {
      const close = text.indexOf(CLOSERS[opener], end);
      const stop = close < 0 ? text.length : close;
      found.push(...names(text.slice(end, stop)));
      text = `${text.slice(0, i - 1)} ${text.slice(stop + 1)}`;
    } else {
      const stop = featEnd(text, end);
      found.push(...names(text.slice(end, stop)));
      text = `${text.slice(0, i)} ${text.slice(stop)}`;
    }
  }
}

function kindOf(text) {
  if (MIXED_BY.test(text) && !REMIX_OR_MASHUP.test(text)) return 'other';
  for (const [kind, rx] of KIND_WORDS) if (rx.test(text)) return kind;
  return 'remix';
}

const byNames = (text, kind) => (kind === 'remix' || kind === 'other' ? names(text.replace(BY_STRIP, ' ')) : []);

function version(text) {
  const kind = kindOf(text);
  return { kind, name: text, by: byNames(text, kind) };
}

function cutRemixSegment(title) {
  const parts = title.split(SEGMENT_SPLIT);
  if (parts.length < 5) return [title, null];
  for (let i = 2; i < parts.length; i += 2) {
    const seg = parts[i].trim();
    if (seg && REMIX_WORD.test(seg)) return [[...parts.slice(0, i - 1), ...parts.slice(i + 1)].join('').trim(), seg];
  }
  return [title, null];
}

function cutRemix(title) {
  for (const m of title.matchAll(BRACKET)) {
    const inner = m[1].trim();
    if (inner && REMIX_WORD.test(inner)) {
      const rest = `${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ');
      return [stripSet(rest, PUNCT), inner];
    }
  }
  return cutRemixSegment(title);
}

function titleVersion(title) {
  const [rest, remix] = cutRemix(title);
  if (remix) return [squash(rest), remix];
  for (const m of title.matchAll(BRACKET)) {
    const inner = m[1].trim();
    if (inner && KIND_WORDS.some(([, rx]) => rx.test(inner))) return [squash(`${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`), inner];
  }
  return [title, null];
}

export function suggest(artist, title, remixer) {
  const notes = [];
  const [primary, feat] = cutFeat(squash(artist ?? ''));
  let featured = feat;
  if (featured.length) notes.push('feat_in_artist');
  const artists = [];
  const seen = new Set();
  const pills = splitTokens(primary);
  for (const pill of pills) {
    for (const name of names(pill)) {
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        artists.push(name);
      }
    }
  }
  if (artists.length > pills.length) notes.push('multi_artist');
  const titleText = String(title ?? '').trim();
  const [cut, titleFeat] = cutFeat(titleText);
  if (titleFeat.length) {
    notes.push('feat_in_title');
    const have = new Set(featured.map((f) => f.toLowerCase()));
    featured = [...featured, ...titleFeat.filter((n) => !have.has(n.toLowerCase()))];
  }
  const [base, fromTitle] = titleVersion(cut);
  const remixerText = squash(remixer ?? '');
  let ver = null;
  if (remixerText) {
    ver = version(remixerText);
    notes.push('remixer_to_version');
    if (fromTitle) notes.push('version_in_title');
  } else if (fromTitle) {
    ver = version(squash(fromTitle));
    notes.push('version_in_title');
  }
  return { artists, featured, version: ver, title: base && base !== titleText ? base : null, notes };
}
