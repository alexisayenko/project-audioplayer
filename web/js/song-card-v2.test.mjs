import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { cardModel } = await import('./song-card.js');
assert.ok(player);

test('cardModel shows albums[0] and never a decade', () => {
  const song = { id: 'v2', title: 'T', mainArtists: ['Zed'], featuredArtists: [], releaseYear: 1994, albums: ['First LP', 'Reissue'], tags: ['genre:house', 'decade:80s', 'country:de'], version: { type: 'remix', name: 'Kav Remix', artists: ['Kav'], releaseYear: 2010 } };
  const m = cardModel(song, { kind: 'none' });
  assert.equal(m.album, 'First LP');
  assert.equal(m.sub, 'Zed · 2010');
  assert.equal(m.remix, 'Kav Remix');
  assert.equal(m.groups.find((g) => g.key === 'decade'), undefined);
  assert.ok(m.details.includes('Remixed / mixed by: Kav'));
});
