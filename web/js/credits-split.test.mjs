import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { suggest } from './credits-split.js';

const FIXTURE = new URL('../../server/tests/fixtures/credits_split_cases.json', import.meta.url);
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;

const RENAME = { artists: 'mainArtists', featured: 'featuredArtists' };
const VERSION_RENAME = { kind: 'type', by: 'artists', of: 'originalArtists' };
const v2 = (want) => Object.fromEntries(Object.entries(want ?? {}).map(([k, val]) => [RENAME[k] ?? k, k === 'version' && val ? Object.fromEntries(Object.entries(val).map(([a, b]) => [VERSION_RENAME[a] ?? a, b])) : k === 'alternatives' && val ? val.map(v2) : val]));

test('a plain single artist suggests nothing new', () => {
  assert.deepEqual(suggest('Haddaway', 'What Is Love', ''), { mainArtists: ['Haddaway'], featuredArtists: [], version: null, title: null, notes: [] });
  assert.deepEqual(suggest('', '', ''), { mainArtists: [], featuredArtists: [], version: null, title: null, notes: [] });
  assert.deepEqual(suggest(null, null, null).mainArtists, []);
});

test('ambiguous separators are split only as a suggestion', () => {
  const s = suggest('Martin Garrix & Tiesto', 'The Only Way Is Up', '');
  assert.deepEqual(s.mainArtists, ['Martin Garrix', 'Tiesto']);
  assert.deepEqual(s.notes, ['multi_artist']);
  assert.deepEqual(suggest('Nadia Ali, Starkillers & Alex Kenji', 'Pressure', '').mainArtists, ['Nadia Ali', 'Starkillers', 'Alex Kenji']);
  assert.deepEqual(suggest('A and B', 'T', '').mainArtists, ['A', 'B']);
  assert.deepEqual(suggest('A x B', 'T', '').mainArtists, ['A', 'B']);
  assert.deepEqual(suggest('A vs. B', 'T', '').mainArtists, ['A', 'B']);
  assert.deepEqual(suggest('A & a', 'T', '').mainArtists, ['A']);
});

test('pills joined by the documented separators stay separate names', () => {
  assert.deepEqual(suggest('A - B', 'T', '').mainArtists, ['A', 'B']);
  assert.deepEqual(suggest('A - B', 'T', '').notes, []);
  assert.deepEqual(suggest('A - B & C', 'T', '').mainArtists, ['A', 'B', 'C']);
});

test('feat in the artist moves to featured', () => {
  const s = suggest('Kato feat. Jon', 'Turn The Lights Off', '');
  assert.deepEqual(s.mainArtists, ['Kato']);
  assert.deepEqual(s.featuredArtists, ['Jon']);
  assert.deepEqual(s.notes, ['feat_in_artist']);
  assert.deepEqual(suggest('Kato ft. Jon & Jim', 'T', '').featuredArtists, ['Jon', 'Jim']);
  assert.deepEqual(suggest('Kato (featuring Jon)', 'T', '').mainArtists, ['Kato']);
});

test('feat in the title gives featured and a base title', () => {
  const s = suggest('Kato', 'Turn The Lights Off (feat. Jon)', '');
  assert.deepEqual(s.featuredArtists, ['Jon']);
  assert.equal(s.title, 'Turn The Lights Off');
  assert.deepEqual(s.notes, ['feat_in_title']);
  assert.deepEqual(suggest('A & B feat. C', 'T (feat. D)', 'X Remix').featuredArtists, ['C', 'D']);
  assert.deepEqual(suggest('A feat. B', 'T (feat. b)', '').featuredArtists, ['B']);
});

test('remixer text gives a version with type, credited text and names', () => {
  assert.deepEqual(suggest('A', 'T', 'Alesso Remix').version, { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'] });
  assert.deepEqual(suggest('A', 'T', 'Gabriel & Dresden Chill Mix').version, { type: 'remix', name: 'Gabriel & Dresden Chill Mix', artists: ['Gabriel', 'Dresden'] });
  assert.deepEqual(suggest('A', 'T', 'Mixed By DJ Gvozd').version, { type: 'other', name: 'Mixed By DJ Gvozd', artists: ['DJ Gvozd'] });
  assert.deepEqual(suggest('A', 'T', 'Remixed by Alesso').version, { type: 'remix', name: 'Remixed by Alesso', artists: ['Alesso'] });
  assert.deepEqual(suggest('A', 'T', 'Live, Royal Albert Hall').version, { type: 'live', name: 'Live, Royal Albert Hall', artists: [] });
  assert.deepEqual(suggest('A', 'T', 'Acoustic').version, { type: 'acoustic', name: 'Acoustic', artists: [] });
  assert.deepEqual(suggest('A', 'T', 'Alesso Remix').notes, ['remixer_to_version']);
});

test('version text inside the title is cut out and offered as a version', () => {
  const s = suggest('A', 'Song (Alesso Remix)', '');
  assert.equal(s.title, 'Song');
  assert.deepEqual(s.version, { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'] });
  assert.deepEqual(s.notes, ['version_in_title']);
  assert.deepEqual(suggest('A', 'Song [Live at Wembley]', '').version.type, 'live');
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
    const got = suggest(input.artist ?? '', input.title ?? '', input.remixer ?? '', c.ctx ?? {});
    const want = v2(c.expect ?? c.expected);
    assert.ok(want, JSON.stringify(c));
    for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], `${k} ${JSON.stringify(c)}`);
  }
});

test('cover parenthetical: original artist, performer, or ambiguous', () => {
  const crazy = suggest('Teemid', 'Crazy feat. Joie Tan (Gnarls Barkley Cover)', '');
  assert.deepEqual(crazy.version, { type: 'cover', name: 'Gnarls Barkley Cover', artists: [], originalArtists: ['Gnarls Barkley'] });
  assert.deepEqual([crazy.featuredArtists, crazy.title], [['Joie Tan'], 'Crazy']);
  const perf = suggest('Sofia Karlberg', 'Writings On The Wall (sófia karlberg cover version)', '');
  assert.deepEqual(perf.version, { type: 'cover', name: 'sófia karlberg cover version', artists: [] });
  assert.ok(perf.notes.includes('cover_performer'));
  assert.deepEqual(suggest('A', 'Song (Gabriel & Dresden Cover)', '').version.originalArtists, ['Gabriel & Dresden']);
  assert.deepEqual(suggest('A ft. B', 'Song ft. C [Dua Lipa Cover]', '').version.originalArtists, ['Dua Lipa']);
  const amb = suggest('', 'Song (X Cover)', '');
  assert.deepEqual(amb.version, { type: 'cover', name: 'X Cover', artists: [] });
  assert.ok(amb.notes.includes('cover_ambiguous'));
});

test('cover rule is whole-word and parenthetical only', () => {
  assert.equal(suggest('A', 'Cover Me Up', '').version, null);
  assert.equal(suggest('A', 'Discovery (Recovery)', '').version, null);
  assert.deepEqual(suggest('A', 'Song (Discovery Cover)', '').version.originalArtists, ['Discovery']);
  assert.equal(suggest('A', 'Song (Cover)', '').version.originalArtists, undefined);
  assert.equal(suggest('Sam Smith', 'Writings On The Wall', 'Sofia Karlberg Cover').version.originalArtists, undefined);
  assert.equal(suggest('A', 'Song (Remix) (X Cover)', '').version.type, 'remix');
});

test('mashup: the credited names are provisional makers, flagged, with no sources guessed', () => {
  const s = suggest('Repost Channel', 'Кончится лето - Yaukoshi, LXST CXNTURY, Цой (mashup)', '');
  assert.deepEqual(s.mainArtists, ['Yaukoshi', 'LXST CXNTURY', 'Цой']);
  assert.deepEqual(s.version, { type: 'mashup', name: 'mashup', artists: [] });
  assert.equal(s.title, 'Кончится лето');
  assert.ok(s.notes.includes('mashup_makers_unknown'));
  const viaRemixer = suggest('Repost Channel', 'Кончится лето - Yaukoshi, LXST CXNTURY, Цой', 'mashup');
  assert.deepEqual(viaRemixer.mainArtists, s.mainArtists);
  assert.equal(viaRemixer.version.type, 'mashup');
});

test('mashup spellings and words that must not match', () => {
  for (const w of ['(mashup)', '[Mash-Up]', '(MASH UP)']) assert.equal(suggest('', `Song - A, B ${w}`, '').version.type, 'mashup', w);
  for (const t of ['Discovery (Mashups)', 'Mashup City', 'Song (Mashup Remix)']) assert.notEqual(suggest('A', t, '').version?.type, 'mashup', t);
});

test('mashup sources only from an explicit x, vs or multiplication-sign split', () => {
  assert.deepEqual(suggest('DJ K', 'Song A x Song B (mashup)', '').version.originalArtists, ['Song A', 'Song B']);
  const named = suggest('', 'DJ K - Song A vs. Song B × Song C (mashup)', '');
  assert.deepEqual(named.version.originalArtists, ['Song A', 'Song B', 'Song C']);
  assert.deepEqual(named.mainArtists, ['DJ K']);
  assert.ok(!named.notes.includes('mashup_makers_unknown'));
  assert.equal(suggest('DJ K', 'Song A & Song B (mashup)', '').version.originalArtists, undefined);
});

test('a label "Cover Release" tag suggests a cover without guessing the original artist', () => {
  const s = suggest('Twin & Elise Lieberth', 'In The End (Magic Cover Release)', '');
  assert.deepEqual(s.mainArtists, ['Twin', 'Elise Lieberth']);
  assert.deepEqual(s.version, { type: 'cover', name: 'Cover', artists: [] });
  assert.equal(s.title, 'In The End');
  assert.deepEqual(s.notes, ['multi_artist', 'release_tag', 'cover_release', 'version_in_title']);
});

test('other "... Release" tags are dropped from the title and never become a version', () => {
  const s = suggest('A', 'Song [NCS Release]', '');
  assert.equal(s.version, null);
  assert.equal(s.title, 'Song');
  assert.equal(suggest('A', 'Song (Foo Remix) (Free Release)', '').version.type, 'remix');
  assert.equal(suggest('A', 'Song (Release)', '').version, null);
});

test('"(mashup by X)" makes X the main artist and the artists before the dash the sources', () => {
  const s = suggest('yaukoshi', 'КИНО x LXST CXNTURY - КОНЧИТСЯ ODIUM', 'mashup by yaukoshi');
  assert.deepEqual(s.mainArtists, ['yaukoshi']);
  assert.deepEqual(s.version, { type: 'mashup', name: 'mashup by yaukoshi', artists: [], originalArtists: ['КИНО', 'LXST CXNTURY'] });
  assert.equal(s.title, 'КОНЧИТСЯ ODIUM');
  assert.deepEqual(suggest('Chan', 'A vs B - Song [DJ K & Q mashup]', '').mainArtists, ['DJ K', 'Q']);
  assert.equal(suggest('Chan', 'A + B - Song (bootleg by X)', '').version.type, 'remix');
});

test('A - T (X Cover): evidence picks the reading, no evidence lists both and decides nothing', () => {
  const t = 'Pharrell Williams - Happy (EFIX & ALLISON Cover)';
  const known = suggest('', t, '', { original: ['Pharrell Williams'] });
  assert.deepEqual([known.mainArtists, known.title, known.version.type, known.version.originalArtists], [['EFIX', 'ALLISON'], 'Happy', 'cover', ['Pharrell Williams']]);
  assert.equal(known.alternatives, undefined);
  assert.deepEqual(suggest('', t, '', { uploader: 'EFIX' }).mainArtists, ['EFIX', 'ALLISON']);
  const none = suggest('', t, '');
  assert.ok(none.notes.includes('cover_ambiguous'));
  assert.deepEqual(none.alternatives.map((r) => r.mainArtists), [['EFIX', 'ALLISON'], ['Pharrell Williams']]);
  const crazy = suggest('', 'Teemid - Crazy feat. Joie Tan (Gnarls Barkley Cover)', '', { original: ['Gnarls Barkley'] });
  assert.deepEqual([crazy.mainArtists, crazy.featuredArtists, crazy.title, crazy.version.originalArtists], [['Teemid'], ['Joie Tan'], 'Crazy', ['Gnarls Barkley']]);
});

test('title first: "Title [X Remix] feat. Y - Artist" is read reversed', () => {
  const want = { artists: ['Tommee Profitt'], featured: ['Fleurie'], title: 'In The End', version: { kind: 'remix', name: 'Mellen Gi Remix', by: ['Mellen Gi'] } };
  const t = 'In The End [Mellen Gi Remix] feat. Fleurie - Tommee Profitt';
  for (const s of [suggest('', t, '', { uploader: 'Tommee Profitt' }), suggest('', t, ''), suggest('Tommee Profitt', 'In The End feat. Fleurie - Tommee Profitt', 'Mellen Gi Remix', { uploader: 'Tommee Profitt' })]) {
    for (const k of Object.keys(want)) assert.deepEqual(s[k], want[k], k);
    assert.ok(s.notes.includes('title_first'));
  }
});

test('title first leaves ordinary titles alone', () => {
  assert.equal(suggest('', 'Artist - Title', '').notes.length, 0);
  assert.equal(suggest('', 'Title - Artist', '').notes.length, 0);
  assert.deepEqual(suggest('', 'Artist - Title (Remix)', '').title, 'Artist - Title');
});
