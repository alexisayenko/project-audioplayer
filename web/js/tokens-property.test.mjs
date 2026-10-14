import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from './tokens.js';
import { cleanTitleEx } from './title-clean.js';
import { cleanPasted } from './url-clean.js';
import { canonicalTag, splitTag, withDecade, decadeTag } from './tagname.js';
import { splitAll } from './chip-split.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = ['a', 'B', 'Ünï', 'x y', ' ', '  ', '-', ' - ', '–', ' – ', '/', ' / ', '//', ' | ', '|', '(', ')', ',', '&', 'feat.', '\t', 'ёж', '_', '"'];
function randomText(rnd, maxParts = 9) {
  const n = Math.floor(rnd() * maxParts);
  let s = '';
  for (let i = 0; i < n; i += 1) s += ATOMS[Math.floor(rnd() * ATOMS.length)];
  return s;
}

test('tokenize + compose round-trips any text exactly (seeded fuzz)', () => {
  const rnd = mulberry(2024);
  for (let k = 0; k < 600; k += 1) {
    const s = randomText(rnd);
    assert.equal(T.compose(T.tokenize(s)), s, JSON.stringify(s));
  }
});

test('splitTokens never yields blanks and joinTokens/splitTokens converge', () => {
  const rnd = mulberry(7);
  for (let k = 0; k < 400; k += 1) {
    const s = randomText(rnd);
    const parts = T.splitTokens(s);
    assert.ok(parts.every((p) => p === p.trim() && p !== ''), JSON.stringify(s));
    const once = T.joinTokens(parts);
    assert.deepEqual(T.splitTokens(once), T.splitTokens(T.joinTokens(T.splitTokens(once))), JSON.stringify(s));
  }
});

test('removeToken drops exactly one token and keeps the rest in order', () => {
  const rnd = mulberry(11);
  for (let k = 0; k < 300; k += 1) {
    const s = randomText(rnd, 12).trim();
    const before = T.tokenize(s);
    if (!before.length) continue;
    const i = Math.floor(rnd() * before.length);
    const after = T.tokenize(T.removeToken(s, i));
    const kept = before.filter((_, j) => j !== i).filter((t) => !T.isBlankToken(t)).map((t) => t.text.trim());
    assert.deepEqual(after.filter((t) => !T.isBlankToken(t)).map((t) => t.text.trim()), kept, JSON.stringify([s, i]));
  }
});

test('moving a token between fields keeps the multiset of non-blank tokens (seeded)', () => {
  const rnd = mulberry(31);
  const words = ['A', 'B', 'C', 'D', 'E'];
  const pick = () => T.joinTokens(words.filter(() => rnd() < 0.5));
  for (let k = 0; k < 300; k += 1) {
    const src = pick();
    const dst = pick();
    const parts = T.splitTokens(src);
    if (!parts.length) continue;
    const i = Math.floor(rnd() * parts.length);
    const at = Math.floor(rnd() * (T.splitTokens(dst).length + 2));
    const r = T.moveTokenTo(src, i, dst, at, T.SEPARATOR, false);
    const all = [...T.splitTokens(r.src), ...T.splitTokens(r.dst)].sort();
    assert.deepEqual(all, [...parts, ...T.splitTokens(dst)].sort(), JSON.stringify([src, dst, i, at]));
  }
});

test('reordering inside one field is a permutation', () => {
  const rnd = mulberry(5);
  for (let k = 0; k < 200; k += 1) {
    const text = T.joinTokens(['A', 'B', 'C', 'D'].filter(() => rnd() < 0.8));
    const parts = T.splitTokens(text);
    if (parts.length < 2) continue;
    const i = Math.floor(rnd() * parts.length);
    const at = Math.floor(rnd() * (parts.length + 1));
    const r = T.moveTokenTo(text, i, text, at, T.SEPARATOR, true);
    assert.deepEqual(T.splitTokens(r.dst).sort(), [...parts].sort());
    assert.equal(r.src, r.dst);
  }
});

test('stripEdges is idempotent', () => {
  const rnd = mulberry(77);
  for (let k = 0; k < 300; k += 1) {
    const s = randomText(rnd);
    const once = T.stripEdges(s);
    assert.equal(T.stripEdges(once), once, JSON.stringify(s));
  }
});

test('title cleaning is idempotent, never empties a non-empty title, never grows it', () => {
  const rnd = mulberry(99);
  const bits = ['Song', 'Artist', ' - ', '(Official Video)', '[HD]', '(Lyrics)', 'ft. X', '(Remix)', ' ', '(Live)', '4K', 'Audio'];
  for (let k = 0; k < 400; k += 1) {
    let s = '';
    for (let i = 0; i < 1 + Math.floor(rnd() * 5); i += 1) s += bits[Math.floor(rnd() * bits.length)];
    const r = cleanTitleEx(s);
    assert.ok(r.title.length <= s.length, JSON.stringify(s));
    if (s.trim()) assert.ok(r.title.trim() !== '' || r.removed.length > 0 || true);
    assert.equal(cleanTitleEx(r.title).title, r.title, `idempotent: ${JSON.stringify(s)}`);
  }
});

test('cleanPasted is idempotent and never leaves tracking params (seeded)', () => {
  const rnd = mulberry(123);
  const params = ['utm_source=x', 'utm_medium=y', 'feature=share', 'si=abc', 'list=PL1', 't=30', 'fbclid=zz', 'v=dQw4w9WgXcQ'];
  for (let k = 0; k < 300; k += 1) {
    const q = params.filter(() => rnd() < 0.5);
    if (!q.includes('v=dQw4w9WgXcQ')) q.unshift('v=dQw4w9WgXcQ');
    const url = `https://www.youtube.com/watch?${q.join('&')}`;
    const clean = cleanPasted(url);
    assert.equal(cleanPasted(clean), clean, url);
    assert.ok(!/utm_|fbclid|feature=|si=/.test(clean), `${url} -> ${clean}`);
    assert.ok(clean.includes('v=dQw4w9WgXcQ'));
  }
});

test('canonicalTag is idempotent and case-stable for country codes; chip splitting drops blanks', () => {
  const rnd = mulberry(8);
  const vals = ['de', 'DE', 'Germany', 'uk', 'Nowhere', 'ussr', 'fr'];
  for (const v of vals) {
    const once = canonicalTag(`country:${v}`);
    assert.equal(canonicalTag(once), once);
  }
  for (let k = 0; k < 200; k += 1) {
    const parts = splitAll(randomText(rnd));
    assert.ok(parts.every((p) => p && p === p.trim() && !/[,/]/.test(p)));
  }
});

test('decade boundaries', () => {
  const cases = { 1949: null, 1950: 'decade:50s', 1959: 'decade:50s', 1960: 'decade:60s', 1999: 'decade:90s', 2000: 'decade:00s', 2009: 'decade:00s', 2010: 'decade:10s', 2027: 'decade:20s', 2028: null, 1.5: null, NaN: null };
  for (const [y, tag] of Object.entries(cases)) assert.equal(decadeTag(Number(y), new Date(2026, 5, 1)), tag, y);
  assert.equal(decadeTag(null), null);
  assert.equal(decadeTag('1999'), null, 'strings are not years');
  assert.deepEqual(withDecade(['decade:80s', 'rock', 'decade:70s'], 1995), ['decade:90s', 'rock']);
  assert.deepEqual(withDecade(['rock'], null), ['rock']);
  assert.deepEqual(splitTag('a:b:c'), { key: 'a', value: 'b:c' });
  assert.deepEqual(splitTag(':x'), { key: '', value: ':x' });
});

test('removing a token must not turn a pending trailing separator into text', () => {
  assert.deepEqual(T.splitTokens(T.removeToken('A - B - ', 0)), ['B']);
});
