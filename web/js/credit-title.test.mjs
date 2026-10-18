import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCreditTitle, legacyArtist } from './credit-title.js';

const FIXTURE = new URL('../../server/tests/fixtures/credit_title_cases.json', import.meta.url);
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;

test('the shared case table is present', () => {
  assert.ok(fixture?.parse?.length > 60);
});

for (const c of fixture?.parse ?? []) {
  test(`parse: ${c.artist} | ${c.title}`, () => {
    const got = parseCreditTitle(c.artist, c.title, { splitVs: c.splitVs ?? false });
    assert.deepEqual(Object.fromEntries(Object.keys(c.expect).map((k) => [k, got[k]])), c.expect);
  });
}

test('removed lists the exact groups', () => {
  assert.deepEqual(parseCreditTitle('A', 'T (feat. C) (with W)').removed, ['(with W)', '(feat. C)']);
});

test('legacyArtist appends feat. and with', () => {
  assert.equal(legacyArtist(['A', 'B'], ['C', 'D'], ['W']), 'A - B feat. C & D with W');
  assert.equal(legacyArtist(['A']), 'A');
});

test('vs splits only when asked', () => {
  assert.deepEqual(parseCreditTitle('A vs. B', 'T').mainArtists, ['A vs. B']);
  assert.deepEqual(parseCreditTitle('A vs. B', 'T', { splitVs: true }).mainArtists, ['A', 'B']);
});
