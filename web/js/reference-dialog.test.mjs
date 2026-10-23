import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { referenceBody, genreChoices } = await import('./reference-dialog.js');
const { referenceBadge } = await import('./song-card.js');
const R = await import('./references.js');

test('the mark payload carries the song id, the role and a trimmed note', () => {
  assert.deepEqual(referenceBody({ id: 's1' }, { role: 'archetype', note: '  ' }), { song_id: 's1', role: 'archetype' });
  assert.deepEqual(referenceBody({ id: 's1' }, { role: 'origin', note: ' first ' }), { song_id: 's1', role: 'origin', note: 'first' });
});

test('the genre choices are the song own genres', () => {
  assert.deepEqual(genreChoices({ tags: ['genre:house', 'genre:deep house', 'country:us'] }), ['house', 'deep house']);
  assert.deepEqual(genreChoices({ tags: [] }), []);
});

test('no badge without marks', () => {
  R.resetReferences();
  assert.equal(referenceBadge('none'), null);
});

test('the mark payload carries the era only when one is chosen', () => {
  assert.deepEqual(referenceBody({ id: 's1' }, { role: 'origin', note: '', era: 'e1' }), { song_id: 's1', role: 'origin', era: 'e1' });
  assert.deepEqual(referenceBody({ id: 's1' }, { role: 'origin', note: '', era: '' }), { song_id: 's1', role: 'origin' });
});
