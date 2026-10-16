import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { suggest } from './credits-split.js';

const FIXTURE = new URL('../../server/tests/fixtures/credits_split_cases.json', import.meta.url);
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;

test('a plain single artist suggests nothing new', () => {
  assert.deepEqual(suggest('Haddaway', 'What Is Love', ''), { artists: ['Haddaway'], featured: [], version: null, title: null, notes: [] });
  assert.deepEqual(suggest('', '', ''), { artists: [], featured: [], version: null, title: null, notes: [] });
  assert.deepEqual(suggest(null, null, null).artists, []);
});

test('ambiguous separators are split only as a suggestion', () => {
  const s = suggest('Martin Garrix & Tiesto', 'The Only Way Is Up', '');
  assert.deepEqual(s.artists, ['Martin Garrix', 'Tiesto']);
  assert.deepEqual(s.notes, ['multi_artist']);
  assert.deepEqual(suggest('Nadia Ali, Starkillers & Alex Kenji', 'Pressure', '').artists, ['Nadia Ali', 'Starkillers', 'Alex Kenji']);
  assert.deepEqual(suggest('A and B', 'T', '').artists, ['A', 'B']);
  assert.deepEqual(suggest('A x B', 'T', '').artists, ['A', 'B']);
  assert.deepEqual(suggest('A vs. B', 'T', '').artists, ['A', 'B']);
  assert.deepEqual(suggest('A & a', 'T', '').artists, ['A']);
});

test('pills joined by the documented separators stay separate names', () => {
  assert.deepEqual(suggest('A - B', 'T', '').artists, ['A', 'B']);
  assert.deepEqual(suggest('A - B', 'T', '').notes, []);
  assert.deepEqual(suggest('A - B & C', 'T', '').artists, ['A', 'B', 'C']);
});

test('feat in the artist moves to featured', () => {
  const s = suggest('Kato feat. Jon', 'Turn The Lights Off', '');
  assert.deepEqual(s.artists, ['Kato']);
  assert.deepEqual(s.featured, ['Jon']);
  assert.deepEqual(s.notes, ['feat_in_artist']);
  assert.deepEqual(suggest('Kato ft. Jon & Jim', 'T', '').featured, ['Jon', 'Jim']);
  assert.deepEqual(suggest('Kato (featuring Jon)', 'T', '').artists, ['Kato']);
});

test('feat in the title gives featured and a base title', () => {
  const s = suggest('Kato', 'Turn The Lights Off (feat. Jon)', '');
  assert.deepEqual(s.featured, ['Jon']);
  assert.equal(s.title, 'Turn The Lights Off');
  assert.deepEqual(s.notes, ['feat_in_title']);
  assert.deepEqual(suggest('A & B feat. C', 'T (feat. D)', 'X Remix').featured, ['C', 'D']);
  assert.deepEqual(suggest('A feat. B', 'T (feat. b)', '').featured, ['B']);
});

test('remixer text gives a version with kind, credited text and names', () => {
  assert.deepEqual(suggest('A', 'T', 'Alesso Remix').version, { kind: 'remix', name: 'Alesso Remix', by: ['Alesso'] });
  assert.deepEqual(suggest('A', 'T', 'Gabriel & Dresden Chill Mix').version, { kind: 'remix', name: 'Gabriel & Dresden Chill Mix', by: ['Gabriel', 'Dresden'] });
  assert.deepEqual(suggest('A', 'T', 'Mixed By DJ Gvozd').version, { kind: 'other', name: 'Mixed By DJ Gvozd', by: ['DJ Gvozd'] });
  assert.deepEqual(suggest('A', 'T', 'Remixed by Alesso').version, { kind: 'remix', name: 'Remixed by Alesso', by: ['Alesso'] });
  assert.deepEqual(suggest('A', 'T', 'Live, Royal Albert Hall').version, { kind: 'live', name: 'Live, Royal Albert Hall', by: [] });
  assert.deepEqual(suggest('A', 'T', 'Acoustic').version, { kind: 'acoustic', name: 'Acoustic', by: [] });
  assert.deepEqual(suggest('A', 'T', 'Alesso Remix').notes, ['remixer_to_version']);
});

test('version text inside the title is cut out and offered as a version', () => {
  const s = suggest('A', 'Song (Alesso Remix)', '');
  assert.equal(s.title, 'Song');
  assert.deepEqual(s.version, { kind: 'remix', name: 'Alesso Remix', by: ['Alesso'] });
  assert.deepEqual(s.notes, ['version_in_title']);
  assert.deepEqual(suggest('A', 'Song [Live at Wembley]', '').version.kind, 'live');
  assert.equal(suggest('A', 'Song (Official Video)', '').version, null);
});

test('a remixer wins over version text in the title and both notes are kept', () => {
  const s = suggest('A', 'Song (Live)', 'Alesso Remix');
  assert.equal(s.version.name, 'Alesso Remix');
  assert.deepEqual(s.notes, ['remixer_to_version', 'version_in_title']);
});

test('input is not mutated and the result is deterministic', () => {
  const a = suggest('A & B feat. C', 'T (feat. D)', 'X Remix');
  assert.deepEqual(a, suggest('A & B feat. C', 'T (feat. D)', 'X Remix'));
});

test('server cases (credits_split_cases.json, section split)', { skip: !fixture?.split }, () => {
  for (const c of fixture.split) {
    const input = c.input ?? c;
    const got = suggest(input.artist ?? '', input.title ?? '', input.remixer ?? '');
    const want = c.expect ?? c.expected;
    assert.ok(want, JSON.stringify(c));
    for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], `${k} ${JSON.stringify(c)}`);
  }
});
