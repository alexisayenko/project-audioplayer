import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installPage, stubFetch } from './test-dom.mjs';
import * as c from './credits.js';
import { withRuntimeDecade } from './tagname.js';
import { splitPlottable, makePoint, groupOf } from './stats-data.js';
import { suggest } from './credits-split.js';
import { planMetadata } from './metadata-apply.js';

installDom();

test('v2 song is structured by mainArtists; albums[0] and version type/artists/originalArtists render', () => {
  const song = { title: 'Pressure', mainArtists: ['Nadia Ali'], featuredArtists: ['Jon'], releaseYear: 2004, albums: ['Original LP', 'Reissue'], version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'], releaseYear: 2012 } };
  assert.equal(c.isStructured(song), true);
  assert.equal(c.isStructured({ artists: ['x'] }), false);
  assert.equal(c.displayLine(song), 'Nadia Ali feat. Jon - Pressure (Alesso Remix)');
  assert.equal(c.albumOf(song), 'Original LP');
  assert.equal(c.albumOf({ albums: [] }), '');
  assert.equal(c.albumOf({ album: 'Flat' }), 'Flat');
  assert.equal(c.releasedYear(song), 2004);
  assert.equal(c.versionTooltip(song), 'Alesso Remix (2012)');
  assert.deepEqual(c.detailsLines(song), [
    { label: 'Version', value: 'Remix' }, { label: 'Version name', value: 'Alesso Remix' },
    { label: 'Remixed / mixed by', value: 'Alesso' }, { label: 'Version year', value: '2012' }, { label: 'First released', value: '2004' },
  ]);
  const cover = { title: 'S', mainArtists: ['B'], version: { type: 'cover', originalArtists: ['A'] } };
  assert.deepEqual(c.detailsLines(cover), [{ label: 'Version', value: 'Cover' }, { label: 'Cover of', value: 'A' }]);
  const hay = c.searchText(song);
  for (const w of ['alesso', 'jon', 'reissue', 'original lp']) assert.ok(hay.includes(w), w);
  assert.ok(c.searchText(cover).includes('\na'));
  assert.deepEqual(c.sortKey(song, 'artist'), ['nadia ali', 'pressure']);
});

test('withRuntimeDecade derives the decade tag from releaseYear and replaces a stale one', () => {
  assert.deepEqual(withRuntimeDecade({ releaseYear: 1994, tags: ['genre:house', 'country:de'] }).tags, ['genre:house', 'country:de', 'decade:90s']);
  assert.deepEqual(withRuntimeDecade({ releaseYear: 2003, tags: ['decade:90s', 'x'] }).tags, ['x', 'decade:00s']);
  assert.deepEqual(withRuntimeDecade({ releaseYear: 1920, tags: ['decade:90s'] }).tags, []);
  const legacy = { year: 1994, tags: ['decade:90s'] };
  assert.equal(withRuntimeDecade(legacy), legacy);
});

test('stats read releaseYear and fall back to the legacy year', () => {
  const r = splitPlottable([{ id: 'a', releaseYear: 1999, bpm: 120 }, { id: 'b', year: 2001, bpm: 120 }, { id: 'c', releaseYear: null, bpm: 120 }]);
  assert.deepEqual(r.plotted.map((s) => s.id), ['a', 'b']);
  assert.equal(r.skipped, 1);
  assert.equal(makePoint({ id: 'a', releaseYear: 1999, bpm: 120 }).year, 1999);
  assert.equal(groupOf({ id: 'a', releaseYear: 1994 }, 'decade').key, '1990');
});

test('credits-split emits the v2 names', () => {
  const s = suggest('A & B feat. C', 'Song (Kav Remix)', '');
  assert.deepEqual(s.mainArtists, ['A', 'B']);
  assert.deepEqual(s.featuredArtists, ['C']);
  assert.equal(s.version.type, 'remix');
  assert.deepEqual(s.version.artists, ['Kav']);
  for (const k of ['artists', 'featured']) assert.ok(!(k in s), k);
  for (const k of ['kind', 'by', 'of']) assert.ok(!(k in s.version), k);
});

test('metadata plan reads albums[0] and releaseYear and still accepts the flat names', () => {
  const cur = { album: '', released: '', versioned: false, tags: [] };
  const v2 = planMetadata({ albums: ['LP'], releaseYear: 1999 }, cur);
  assert.deepEqual([v2.album, v2.released], ['LP', 1999]);
  const flat = planMetadata({ album: 'LP', year: 2001 }, cur);
  assert.deepEqual([flat.album, flat.released], ['LP', 2001]);
});

test('Library filters and decade chips use the decade computed from releaseYear', async () => {
  await installPage();
  globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
  stubFetch(() => ({ body: { songs: [], artists: [] } }));
  const { store, tagCounts } = await import('./store.js');
  const { visibleSongs, unsetCount, filterByTags } = await import('./library-data.js');
  const songs = [
    { id: 'a', title: 'A', mainArtists: ['X'], releaseYear: 1994, tags: ['genre:house', 'decade:80s'] },
    { id: 'b', title: 'B', mainArtists: ['Y'], releaseYear: 2005, tags: ['country:fr'] },
    { id: 'c', title: 'C', mainArtists: ['Z'], releaseYear: null, tags: [] },
  ];
  store.songs = songs;
  store.tags = tagCounts(songs);
  assert.deepEqual(store.tags.map((t) => t.tag).sort(), ['country:fr', 'decade:00s', 'decade:90s', 'genre:house']);
  filterByTags(['decade:90s']);
  assert.deepEqual(visibleSongs().map((s) => s.id), ['a']);
  assert.equal(unsetCount('years'), 1);
});
