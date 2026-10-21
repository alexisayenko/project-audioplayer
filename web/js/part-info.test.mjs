import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { lineParts, titleInfo, versionInfo, artistInfoStub, infoRows, partInfo } = await import('./part-info.js');
const { displayLine } = await import('./credits.js');

const kinds = (s) => lineParts(s).filter((p) => p.kind !== 'text').map((p) => `${p.kind}:${p.text}`);
const joined = (s) => lineParts(s).map((p) => p.text).join('');

test('parts: two artists, title and version are separate; joining words stay text', () => {
  const s = { title: 'Pressure', mainArtists: ['Nadia Ali', 'Starkillers'], featuredArtists: ['Alex Kenji'], version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'] } };
  assert.deepEqual(kinds(s), ['artist:Nadia Ali', 'artist:Starkillers', 'artist:Alex Kenji', 'title:Pressure', 'version:Alesso Remix']);
  assert.equal(joined(s), displayLine(s));
  assert.equal(joined(s), 'Nadia Ali & Starkillers feat. Alex Kenji - Pressure (Alesso Remix)');
  assert.ok(lineParts(s).filter((p) => p.kind === 'text').map((p) => p.text).includes(' & '));
});

test('parts: comma lists, with-artists, and artist names that contain & stay whole', () => {
  const s = { title: 'T', mainArtists: ['A', 'B', 'Simon & Garfunkel'], featuredArtists: ['F'], withArtists: ['W'] };
  assert.deepEqual(kinds(s), ['artist:A', 'artist:B', 'artist:Simon & Garfunkel', 'artist:F', 'artist:W', 'title:T']);
  assert.equal(joined(s), displayLine(s));
});

test('parts: no artist, no version, title only; artist only', () => {
  assert.deepEqual(kinds({ title: 'T', mainArtists: [] }), ['title:T']);
  assert.equal(joined({ title: 'T', mainArtists: [] }), 'T');
  assert.deepEqual(kinds({ title: '', mainArtists: ['A'] }), ['artist:A']);
});

test('parts: legacy artist string splits on and, &, comma and feat.', () => {
  const s = { title: 'Alpha', remixer: 'Kav', artist: 'Zed & Yan, Xu feat. Wu and Vi' };
  assert.deepEqual(kinds(s), ['artist:Zed', 'artist:Yan', 'artist:Xu', 'artist:Wu', 'artist:Vi', 'title:Alpha', 'version:Kav']);
  assert.equal(joined(s), `${s.artist} - Alpha (Kav)`);
});

test('title and version info come from the song; the version year falls back to the song year', () => {
  const s = { title: 'T', mainArtists: ['A'], releaseYear: 1999, albums: ['LP', 'Best of'], genres: ['house'], version: { type: 'remix', name: 'X Remix', releaseYear: 2012 } };
  assert.deepEqual(titleInfo(s), { year: '1999', albums: ['LP', 'Best of'], genres: ['house'] });
  assert.equal(versionInfo(s).year, '2012');
  assert.equal(versionInfo({ ...s, version: { type: 'remix', name: 'X Remix' } }).year, '1999');
  assert.deepEqual(titleInfo({ title: 'T', tags: ['genre:rock', 'country:de'] }).genres, ['rock']);
});

test('rows omit empty data and name Album or Albums', () => {
  assert.deepEqual(infoRows('title', { year: '', albums: [], genres: [] }), []);
  assert.deepEqual(infoRows('title', { year: '1999', albums: ['LP'], genres: ['rock'] }).map((r) => r.label), ['Year of release', 'Album', 'Genres']);
  assert.equal(infoRows('version', { year: '', albums: ['A', 'B'], genres: [] })[0].label, 'Albums');
});

test('artist info is the stub with the contract shape', () => {
  const info = artistInfoStub('Zed');
  assert.equal(typeof info.country, 'string');
  assert.ok(Array.isArray(info.genres) && info.genres.length > 0);
  assert.equal(typeof info.years, 'string');
  assert.deepEqual(infoRows('artist', info).map((r) => r.label), ['Country', 'Genres', 'Years of activity']);
  const p = partInfo({ title: 'T', mainArtists: ['Zed'] }, { kind: 'artist', text: 'Zed', name: 'Zed' });
  assert.equal(p.filter, 'Zed');
  assert.equal(p.heading, 'Zed');
  assert.equal(partInfo({ title: 'Black Betty', mainArtists: ['Ram Jam'] }, { kind: 'title', text: 'Black Betty' }).filter, 'Black Betty');
});
