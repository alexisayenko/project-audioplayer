import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { initPlayer } = await import('./player.js');
initPlayer();
const { cardModel } = await import('./song-card.js');

test('cardModel shows albums[0] and never a decade', () => {
  const song = { id: 'v2', title: 'T', mainArtists: ['Zed'], featuredArtists: [], releaseYear: 1994, albums: ['First LP', 'Reissue'], tags: ['genre:house', 'decade:80s', 'country:de'], version: { type: 'remix', name: 'Kav Remix', artists: ['Kav'], releaseYear: 2010 } };
  const m = cardModel(song, { kind: 'none' });
  assert.equal(m.album, 'First LP');
  assert.equal(m.sub, 'Zed · 2010');
  assert.equal(m.remix, 'Kav Remix');
  assert.equal(m.groups.find((g) => g.key === 'decade'), undefined);
  assert.ok(m.details.includes('Remix by: Kav'));
});

test('the line under the cover is the full title: artists, featured artists, title and version', () => {
  const remix = { id: 'r', title: 'Fading', mainArtists: ['Didrik Thulin', 'Sonny Alven'], featuredArtists: [], releaseYear: 2019, version: { type: 'remix', name: 'MKJ Remix', artists: ['MKJ'] } };
  assert.equal(cardModel(remix).full, 'Didrik Thulin & Sonny Alven - Fading (MKJ Remix)');
  const cover = { id: 'c', title: 'Crazy', mainArtists: ['Teemid'], featuredArtists: ['Joie Tan'], releaseYear: 2019, version: { type: 'cover', name: 'Gnarls Barkley Cover', originalArtists: ['Gnarls Barkley'] } };
  assert.equal(cardModel(cover).full, 'Teemid feat. Joie Tan - Crazy (Gnarls Barkley Cover)');
  assert.equal(cardModel({ id: 'p', title: 'One More Time', mainArtists: ['Daft Punk'], featuredArtists: [] }).full, 'Daft Punk - One More Time');
});
