import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { OTHERS_VOCAB } = await import('./genre-others-fixture.mjs');

test('the song card model: a song with house and trance has an Others line, and a stored electronic pill is kept as typed on its own line', async () => {
  const { buildTree } = await import('./genre-levels.js');
  const { resetGenreTree } = await import('./genre-tree.js');
  const { cardModel } = await import('./song-card.js');
  const v = { ...OTHERS_VOCAB, levels: { ...OTHERS_VOCAB.levels, trance: { parents: ['Others'], discogs: true, synonyms: [], provisional: false } } };
  resetGenreTree(buildTree(v));
  const m = cardModel({ id: 'x', title: 'T', tags: ['genre:house', 'genre:trance', 'genre:electronic'] });
  assert.deepEqual(m.genreLines, [{ family: 'Others', genres: ['Others', 'house', 'trance'] }, { family: null, genres: ['electronic'] }]);
  resetGenreTree(null);
});
