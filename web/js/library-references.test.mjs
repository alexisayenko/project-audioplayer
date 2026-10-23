import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch((url) => {
  if (url === '/me') return { body: { owner: true } };
  if (url === '/genres/references') return { body: { references: {}, by_song: { a: [{ genre: 'house', role: 'origin' }], b: [{ genre: 'trance', role: 'archetype' }, { genre: 'house', role: 'landmark' }] } } };
  return { body: { songs: [] } };
});
const { store } = await import('./store.js');
const { prefs, visibleSongs } = await import('./library-data.js');
const R = await import('./references.js');
const { refStar } = await import('./library-rows.js');

test('the Reference tracks filter keeps marked songs, optionally by role', async () => {
  store.songs = [{ id: 'a', title: 'A', tags: [] }, { id: 'b', title: 'B', tags: [] }, { id: 'c', title: 'C', tags: [] }];
  await R.loadReferences({ force: true });
  prefs.refs = '';
  assert.equal(visibleSongs().length, 3);
  prefs.refs = 'any';
  assert.deepEqual(visibleSongs().map((s) => s.id).sort(), ['a', 'b']);
  prefs.refs = 'archetype';
  assert.deepEqual(visibleSongs().map((s) => s.id), ['b']);
  prefs.refs = 'breakthrough';
  assert.deepEqual(visibleSongs(), []);
  prefs.refs = '';
});

test('the star shows only for reference songs and names the genres', () => {
  assert.equal(refStar({ id: 'c' }), null);
  const star = refStar({ id: 'b' });
  assert.match(star.title, /Reference track for trance \(Archetype\), house \(Landmark\)/);
});
