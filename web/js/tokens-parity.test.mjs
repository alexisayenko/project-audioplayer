import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitTokens, joinTokens, tokenize, compose } from './tokens.js';

const FIXTURE = new URL('../../server/tests/fixtures/token_cases.json', import.meta.url);
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
const list = (j) => (Array.isArray(j) ? j : j?.cases ?? []);

const INLINE = [
  ['A - B', ['A', 'B']],
  ['A & B', ['A & B']],
  ['A, B & C', ['A, B & C']],
  ['A feat. B', ['A feat. B']],
  ['A | B', ['A', 'B']],
  ['A / B', ['A', 'B']],
  ['A // B', ['A', 'B']],
  ['A – B — C', ['A', 'B', 'C']],
  ['Bi-2', ['Bi-2']],
  ['', []],
  ['  ', []],
];

test('splitTokens follows the documented separators, never & , or feat.', () => {
  for (const [text, want] of INLINE) assert.deepEqual(splitTokens(text), want, text);
});

test('join and split round-trip', () => {
  for (const [, parts] of INLINE) assert.deepEqual(splitTokens(joinTokens(parts)), parts);
});

test('compose(tokenize(text)) restores the text', () => {
  for (const [text] of INLINE) assert.equal(compose(tokenize(text)), text);
});

test('the server twin cases (token_cases.json) match', { skip: !fixture }, () => {
  for (const c of list(fixture)) {
    const input = c.input ?? c.text ?? c.s;
    const want = c.tokens ?? c.split ?? c.pills ?? c.expected;
    if (!Array.isArray(want)) continue;
    const got = want.length && typeof want[0] === 'object' ? tokenize(input) : splitTokens(input);
    assert.deepEqual(got, want, JSON.stringify(input));
  }
});
