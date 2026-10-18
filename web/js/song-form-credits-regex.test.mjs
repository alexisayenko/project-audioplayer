import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PATTERNS } from './song-form-credits.js';

const OLD = {
  COVER_SUFFIX: /[\s,:-]*\bcover(?:\s+version)?\s*$/i,
  ORIGINAL_SPLIT: /\s*(?:,|&|\band\b)\s*/i,
};

const FIXTURES = ['credits_split_cases.json', 'title_clean_cases.json', 'credit_title_cases.json']
  .map((n) => new URL(`../../server/tests/fixtures/${n}`, import.meta.url))
  .filter((u) => fs.existsSync(u));

function strings(value, out) {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const WORDS = ['A', 'Bob', 'x', 'X', 'and', 'AND', 'vs', 'vs.', 'VS', '&', '+', '×', ',', 'feat.', 'ft', 'feat', 'mix', 'Edit', 'version', 'cover', 'Cover Version', 'release', 'Release', 'mashup', 'mash up', 'mash-up', 'by', 'Mashup by', '(', ')', '[', ']', '-', '/', ':', '(Mashup)', '[Remix Release]', '(Cover)', 'a'];
const SPACES = ['', ' ', ' ', '  ', '\t', ' \n ', '   '];

function rng(seed) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function inputs() {
  const set = new Set();
  for (const url of FIXTURES) strings(JSON.parse(fs.readFileSync(url, 'utf8')), set);
  const rand = rng(12345);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  for (let i = 0; i < 12000; i += 1) {
    let s = pick(SPACES);
    const n = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < n; j += 1) s += pick(WORDS) + pick(SPACES);
    set.add(s);
  }
  return [...set];
}

const cases = inputs();

const view = (m) => (m ? { index: m.index, all: [...m], groups: m.groups ? { ...m.groups } : null } : null);

for (const name of Object.keys(OLD)) {
  test(`${name}: new pattern matches exactly like the old one`, () => {
    const old = OLD[name];
    const now = PATTERNS[name];
    assert.equal(now.flags, old.flags);
    for (const s of cases) {
      assert.deepEqual(view(now.exec(s)), view(old.exec(s)), JSON.stringify(s));
      assert.deepEqual(s.split(now), s.split(old), JSON.stringify(s));
      assert.equal(s.replace(now, '|'), s.replace(old, '|'), JSON.stringify(s));
    }
  });

  test(`${name}: long whitespace runs stay linear`, () => {
    const now = PATTERNS[name];
    const runs = [' '.repeat(40000), `${' '.repeat(40000)}x`, `a${' '.repeat(40000)}`, `(${' '.repeat(40000)}`, `${' '.repeat(40000)}(a`, `a ${' '.repeat(40000)}-`];
    const t0 = performance.now();
    for (const s of runs) {
      now.exec(s);
      s.split(now);
    }
    assert.ok(performance.now() - t0 < 1500);
  });
}
