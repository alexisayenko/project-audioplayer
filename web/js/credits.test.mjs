import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';
import * as c from './credits.js';
import * as dt from './display-title.js';
import { trackSub } from './track-sub.js';

installDom();

const A = { title: 'The Only Way Is Up', mainArtists: ['Martin Garrix', 'Tiesto'], featuredArtists: [], releaseYear: null };
const B = { title: 'What Is Love', mainArtists: ['Haddaway'], featuredArtists: [], releaseYear: 1993 };
const Cc = { title: 'Cold Heart', mainArtists: ['Dua Lipa', 'Elton John'], featuredArtists: [], releaseYear: null, version: { type: 'live', name: 'Live, Royal Albert Hall', artists: [], releaseYear: null } };
const D = { title: 'Pressure', mainArtists: ['Nadia Ali', 'Starkillers', 'Alex Kenji'], featuredArtists: [], releaseYear: null, version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'], releaseYear: 2012 } };
const E = { title: 'Song', mainArtists: ['Artist B'], featuredArtists: [], releaseYear: null, version: { type: 'cover', name: null, artists: [], releaseYear: null, originalArtists: 'Artist A' } };
const F = { title: 'Turn The Lights Off', mainArtists: ['Kato'], featuredArtists: ['Jon'], releaseYear: 2009 };

test('joinNames forms', () => {
  assert.equal(c.joinNames([]), '');
  assert.equal(c.joinNames(['A']), 'A');
  assert.equal(c.joinNames(['A', 'B']), 'A & B');
  assert.equal(c.joinNames(['A', 'B', 'C']), 'A, B & C');
  assert.equal(c.joinNames(['A', ' ', 'B', 'C', 'D']), 'A, B, C & D');
  assert.equal(c.joinNames(null), '');
});

test('artist and display lines for examples A-F', () => {
  assert.equal(c.displayLine(A), 'Martin Garrix & Tiesto - The Only Way Is Up');
  assert.equal(c.displayLine(B), 'Haddaway - What Is Love');
  assert.equal(c.displayLine(Cc), 'Dua Lipa & Elton John - Cold Heart (Live, Royal Albert Hall)');
  assert.equal(c.displayLine(D), 'Nadia Ali, Starkillers & Alex Kenji - Pressure (Alesso Remix)');
  assert.equal(c.artistLine(F), 'Kato feat. Jon');
  assert.equal(c.displayLine(F), 'Kato feat. Jon - Turn The Lights Off');
  assert.equal(c.displayLine({ title: 'Solo', mainArtists: [], featuredArtists: [] }), 'Solo');
});

test('cover rule: covering artist first, cover marker after the title', () => {
  assert.equal(c.displayLine(E), 'Artist B - Song (cover)');
  assert.equal(c.titleLine(E), 'Song (cover)');
  assert.deepEqual(c.detailsLines(E), [
    { label: 'Version', value: 'Cover' },
    { label: 'Cover of', value: 'Artist A' },
  ]);
  assert.deepEqual(c.detailsLines({ ...E, version: { ...E.version, originalArtists: ['Artist A'] } }).at(-1), { label: 'Cover of', value: 'Artist A' });
});

test('mashup: makers first, kind word after the title, Mashup of lists the sources', () => {
  const M = { title: 'Кончится лето', mainArtists: ['Yaukoshi', 'LXST CXNTURY', 'Цой'], featuredArtists: [], version: { type: 'mashup', name: null, artists: [], releaseYear: null, originalArtists: ['S1', 'S2'] } };
  assert.equal(c.displayLine(M), 'Yaukoshi, LXST CXNTURY & Цой - Кончится лето (mashup)');
  assert.deepEqual(c.detailsLines(M), [{ label: 'Version', value: 'Mashup' }, { label: 'Mashup of', value: 'S1, S2' }]);
  assert.ok(c.searchText(M).includes('s2'));
  assert.deepEqual(c.ofNames('Legacy'), ['Legacy']);
  assert.deepEqual(c.ofNames(null), []);
});

test('version label: name wins, kind word as fallback, other is silent, dedupe against title', () => {
  assert.equal(c.titleLine({ title: 'S', mainArtists: [], version: { type: 'live', name: null } }), 'S (live)');
  assert.equal(c.titleLine({ title: 'S', mainArtists: [], version: { type: 'other', name: null, releaseYear: 2020 } }), 'S');
  assert.equal(c.titleLine({ title: 'S (Live)', mainArtists: [], version: { type: 'live', name: null } }), 'S (Live)');
  assert.equal(c.titleLine({ title: 'S (Kav Remix)', mainArtists: [], version: { type: 'remix', name: 'Kav Remix' } }), 'S (Kav Remix)');
  assert.equal(c.titleLine({ title: 'S', mainArtists: [], version: { type: 'remix', name: 'A - B | C' } }), 'S (A, B, C)');
  assert.equal(c.titleLine({ title: 'S (Kav Remix)', mainArtists: [], version: { type: 'remix', name: 'Kav - Bob' } }), 'S (Kav Remix) (Bob)');
});

test('tooltip and title nodes carry the version year', () => {
  assert.equal(c.versionTooltip(D), 'Alesso Remix (2012)');
  assert.equal(c.versionTooltip(Cc), 'Live, Royal Albert Hall');
  assert.equal(c.versionTooltip(A), '');
  const nodes = c.titleNodes(D);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[2].title, 'Alesso Remix (2012)');
  assert.equal(nodes.map((n) => n.textContent).join(''), 'Pressure (Alesso Remix)');
  assert.ok(!c.titleNodes(Cc)[2].title);
  assert.equal(c.titleNodes(A).length, 1);
});

test('subtitle, released year and details order', () => {
  assert.equal(c.subtitle(B), 'Haddaway · 1993');
  assert.equal(c.subtitle(F), 'Kato feat. Jon · 2009');
  assert.equal(c.subtitle(A), 'Martin Garrix & Tiesto');
  assert.equal(c.releasedYear(B), 1993);
  assert.equal(c.releasedYear({ mainArtists: [], releaseYear: null, year: 2001 }), 2001);
  assert.equal(c.releasedYear({ mainArtists: [], releaseYear: null }), null);
  assert.deepEqual(c.detailsLines({ ...D, releaseYear: 2009 }).map((d) => d.label),
    ['Version', 'Version name', 'Remixed / mixed by', 'Version year', 'First released']);
  assert.deepEqual(c.detailsLines(A), []);
});

test('sort and search keys', () => {
  assert.deepEqual(c.sortKey(D, 'artist'), ['nadia ali', 'pressure']);
  assert.deepEqual(c.sortKey(D, 'title'), ['pressure']);
  assert.deepEqual(c.sortKey({ title: 'T', artist: 'ZED' }, 'artist'), ['zed', 't']);
  assert.ok(c.compareKeys(['a', 'x'], ['a', 'y']) < 0);
  const hay = c.searchText(D, ['rock']);
  for (const w of ['pressure', 'nadia ali', 'starkillers', 'alesso remix', 'alesso', 'rock']) assert.ok(hay.includes(w), w);
  assert.ok(c.searchText(E).includes('artist a'));
  assert.ok(c.searchText(F).includes('jon'));
  assert.equal(c.searchText({ title: 'T', artist: 'AR', album: 'Al', remixer: 'RM' }), 't\nar\nal\nrm');
});

test('legacy-only songs keep the old behaviour', () => {
  assert.deepEqual(dt.displayTitle({ title: 'Song', remixer: '  ' }), { title: 'Song', remix: '' });
  assert.equal(dt.displayString({ title: 'Song', remixer: 'A - B | C' }), 'Song (A, B, C)');
  assert.equal(dt.displayString({ title: 'Song (Kav Verhouzer Remix)', remixer: 'Kav Verhouzer - Bob' }), 'Song (Kav Verhouzer Remix) (Bob)');
  assert.equal(dt.displayString(null), '');
  const song = { title: 'Song', remixer: 'Kav Verhouzer Remix', remix_year: 2024 };
  assert.equal(dt.remixTooltip(song), 'Kav Verhouzer Remix (2024)');
  assert.equal(dt.remixTooltip({ title: 'Song', remix_year: 2024 }), '');
  assert.equal(dt.titleNodes(song)[2].title, 'Kav Verhouzer Remix (2024)');
  assert.equal(dt.subtitleString({ title: 'x', artist: 'Kato feat. Jon', year: 2026 }), 'Kato feat. Jon · 2026');
  assert.equal(trackSub({ artist: ' A ', year: 2001 }), 'A · 2001');
  assert.equal(c.artistLine({ title: 'x', artist: 'A & B' }), 'A & B');
  assert.equal(c.tooltipLine({ title: 'Song', remixer: 'Kav', artist: 'Zed' }), 'Song (Kav) - Zed');
  assert.equal(c.tooltipLine({ title: 'Song' }), 'Song');
  assert.equal(c.tooltipLine(D), c.displayLine(D));
  assert.equal(c.isStructured({ title: 'x' }), false);
});

test('a version marker is hidden only by a whole word of the title', () => {
  assert.equal(c.displayLine({ title: 'Recovery', mainArtists: ['B'], version: { type: 'cover' } }), 'B - Recovery (cover)');
  assert.equal(c.displayLine({ title: 'Alive', mainArtists: ['B'], version: { type: 'live' } }), 'B - Alive (live)');
  assert.equal(c.displayLine({ title: 'Song (Live)', mainArtists: ['B'], version: { type: 'live' } }), 'B - Song (Live)');
});

test('displayed year is the version year, else the original, never the upload date', () => {
  const R = { title: 'Running Up That Hill', mainArtists: ['Kate Bush'], releaseYear: 1985, version: { type: 'remix', name: 'Pure Orkidea Pure Progressive Mix', releaseYear: 2012 } };
  assert.equal(c.subtitle(R), 'Kate Bush · 2012');
  assert.equal(c.displayYear(R), 2012);
  assert.equal(c.yearFact(R), '2012 · original 1985');
  assert.equal(c.yearFact({ ...R, releaseYear: 2012 }), '2012');
  assert.equal(c.yearFact({ ...R, releaseYear: null }), '2012');
  const noYear = { ...R, version: { ...R.version, releaseYear: null } };
  assert.equal(c.subtitle(noYear), 'Kate Bush · 1985');
  assert.equal(c.yearFact(noYear), '');
  assert.equal(c.subtitle({ title: 'S', artist: 'A', year: 1985, remix_year: 2012 }), 'A · 2012');
  assert.equal(c.subtitle({ title: 'S', artist: 'A', year: 1985, remix_year: null, upload_date: '2024-01-01' }), 'A · 1985');
  assert.equal(c.displayYear({ title: 'S' }), null);
});
