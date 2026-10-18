// Twin of server/app/credit_title.py; both are driven by server/tests/fixtures/credit_title_cases.json. Change them together.
import { splitTokens, joinTokens } from './tokens.js';
import { joinNames } from './credits.js';

const WORD = String.raw`[\p{L}\p{N}_]`;
const KEY = new RegExp(String.raw`(?<!${WORD})(?:featuring|feat|ft)(?!${WORD})(\.?)`, 'giu');
const KEY_HEAD = new RegExp(String.raw`^(?:featuring|feat|ft)(?!${WORD})(\.?)`, 'iu');
const NUMBER = /^\d[\d.,'"′″]*$/;
const TAIL_BRACKET = /[([]([^()[\]]*)[)\]]\s*$/;
const WITH_HEAD = /^with\s+(?=\S)/i;
const STOPS = [' - ', ' – ', ' — ', ' | ', ' ●● ', ' • ', ')', ']', '(', '['];
const NAME_SEP = /(?<!\s)\s+(?:,\s*|(?:&|\+|x|[aA][nN][dD]|[vV][sS]\.?)\s+)|,\s*/; // NOSONAR patterns are twins of the Python ones, pinned by shared fixtures and differential/timing tests; linear on bounded title input
const VS = /(?<!\s)\s+vs\.?\s+/i;
const EDGE = new Set([' ', '-', '|']);

const strip = (s) => {
  let a = 0;
  let b = s.length;
  while (a < b && EDGE.has(s[a])) a += 1;
  while (b > a && EDGE.has(s[b - 1])) b -= 1;
  return s.slice(a, b);
};
const squash = (s) => strip(s.replace(/\s+/g, ' '));
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const isSpace = (c) => c !== undefined && /\s/.test(c);

function prevIsNumber(text, end) {
  let i = end;
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i -= 1;
  let j = i;
  while (j > 0 && !isSpace(text[j - 1])) j -= 1;
  return j < i && NUMBER.test(text.slice(j, i));
}

function isKeyword(text, m) {
  const end = m.index + m[0].length;
  if (end >= text.length || !isSpace(text[end]) || prevIsNumber(text, m.index)) return false;
  if (m[1] || m[0].toLowerCase() === 'featuring') return true;
  let i = end;
  while (i < text.length && isSpace(text[i])) i += 1;
  return i < text.length && (/\p{Lu}/u.test(text[i]) || /\p{Nd}/u.test(text[i]));
}

const nameStart = (text) => {
  const c = [...text][0];
  return !!c && /[\p{L}\p{N}]/u.test(c) && !/\p{Ll}/u.test(c);
};

function groupNames(inner) {
  const m = KEY_HEAD.exec(inner);
  if (m && isKeyword(inner, m) && inner.slice(m[0].length).trim()) return ['feat', inner.slice(m[0].length).trim()];
  const w = WITH_HEAD.exec(inner);
  if (w && nameStart(inner.slice(w[0].length))) return ['with', inner.slice(w[0].length).trim()];
  return null;
}

function featEnd(text, start) {
  const ends = STOPS.map((s) => text.indexOf(s, start)).filter((i) => i >= 0);
  return ends.length ? Math.min(...ends) : text.length;
}

function group(text, withOk) {
  const m = TAIL_BRACKET.exec(text);
  if (m) {
    const found = groupNames(m[1].trim());
    if (found && (found[0] === 'feat' || withOk)) return { rest: squash(text.slice(0, m.index)), kind: found[0], names: found[1], removed: m[0].trim() };
  }
  for (const k of text.matchAll(KEY)) {
    if (!isKeyword(text, k)) continue;
    const before = text.slice(0, k.index).trimEnd();
    if (before.endsWith('(') || before.endsWith('[')) return null;
    const kend = k.index + k[0].length;
    const stop = featEnd(text, kend);
    if (stop < text.length && ')]'.includes(text[stop])) return null;
    return { rest: squash(`${before} ${text.slice(stop)}`), kind: 'feat', names: text.slice(kend, stop).trim(), removed: text.slice(k.index, stop).trim() };
  }
  return null;
}

function namesOf(text) {
  const out = [];
  const seen = new Set();
  for (const part of text.split(NAME_SEP)) {
    const name = strip(part);
    if (name && !seen.has(fold(name))) {
      seen.add(fold(name));
      out.push(name);
    }
  }
  return out;
}

function unique(names, taken) {
  const out = [];
  for (const n of names) {
    const key = fold(n);
    if (!taken.has(key)) {
      taken.add(key);
      out.push(n);
    }
  }
  return out;
}

function vsParts(pill) {
  const parts = pill.split(VS).map((p) => p.trim());
  return parts.length > 1 && parts.every(Boolean) ? parts : [pill];
}

const pillMains = (pill, splitVs) => (splitVs ? vsParts(pill) : [pill]);

function artistCredits(artist, splitVs) {
  const mains = [];
  let featured = [];
  let guessed = false;
  for (const pill of splitTokens(artist ?? '')) {
    const g = group(pill, false);
    const names = g ? namesOf(g.names) : [];
    if (g && names.length && g.rest) {
      guessed = guessed || names.length > 1;
      featured = [...featured, ...names];
      mains.push(...pillMains(g.rest, splitVs));
    } else mains.push(...pillMains(pill, splitVs));
  }
  return { mains, featured, guessed };
}

function titleCredits(text) {
  let work = text.trim();
  let featured = [];
  let withs = [];
  let guessed = false;
  const notes = [];
  const removed = [];
  const done = new Set();
  for (let i = 0; i < 2; i += 1) {
    const g = group(work, true);
    const names = g ? namesOf(g.names) : [];
    if (!g || !names.length || done.has(g.kind)) break;
    if (!g.rest) {
      notes.push('title_empty');
      break;
    }
    guessed = guessed || names.length > 1;
    if (g.kind === 'feat') featured = [...featured, ...names];
    else withs = [...withs, ...names];
    removed.push(g.removed);
    work = g.rest;
    done.add(g.kind);
  }
  return { work, featured, withs, guessed, notes, removed };
}

export function parseCreditTitle(artist, title, { splitVs = false } = {}) {
  const text = title ?? '';
  const fromArtist = artistCredits(artist, splitVs);
  const fromTitle = titleCredits(text);
  const notes = fromTitle.notes;
  if (fromArtist.guessed || fromTitle.guessed) notes.unshift('feat_split_guess');
  const mains = fromArtist.mains;
  const taken = new Set(mains.map(fold));
  const featured = unique([...fromArtist.featured, ...fromTitle.featured], taken);
  const withs = unique(fromTitle.withs, taken);
  const { removed, work } = fromTitle;
  return { mainArtists: mains, featuredArtists: featured, withArtists: withs, title: removed.length ? work : text, notes, removed };
}

export function legacyArtist(mains, featured = [], withs = []) {
  let line = joinTokens(mains);
  if (featured.length) line = line ? `${line} feat. ${joinNames(featured)}` : `feat. ${joinNames(featured)}`;
  if (withs.length) line = line ? `${line} with ${joinNames(withs)}` : `with ${joinNames(withs)}`;
  return line;
}

export const PATTERNS = { NAME_SEP, VS };
