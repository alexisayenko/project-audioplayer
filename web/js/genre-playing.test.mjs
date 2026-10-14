import test from 'node:test';
import assert from 'node:assert/strict';
import { songGenres, mapToNodes, nodeIds, nowPlayingState } from './genre-playing.js';

const g = { nodes: [{ id: 'Q1', label: 'House', tags: ['house'] }, { id: 'Q2', label: 'Drum and bass', tags: [] }] };

test('songGenres keeps only genre tags, normalised and de-duplicated', () => {
  const s = { tags: ['genre:House', 'decade:90s', 'country:lt', 'lang:ru', 'genre: house ', 'genre:Drum  and Bass', 'plain'] };
  assert.deepEqual(songGenres(s).map((x) => x.key), ['house', 'drum and bass']);
  assert.deepEqual(songGenres(null), []);
});

test('mapToNodes resolves tags and node labels, unknown stay null', () => {
  const items = mapToNodes(songGenres({ tags: ['genre:house', 'genre:drum and bass', 'genre:zouk'] }), g);
  assert.deepEqual(items.map((x) => x.id), ['Q1', 'Q2', null]);
  assert.deepEqual(nodeIds(items), ['Q1', 'Q2']);
  assert.deepEqual(mapToNodes(songGenres({ tags: ['genre:house'] }), null).map((x) => x.id), [null]);
});

test('nowPlayingState distinguishes idle, no genres and ready', () => {
  assert.equal(nowPlayingState(null, []).kind, 'idle');
  assert.equal(nowPlayingState({}, []).hint, 'This song has no genres');
  assert.equal(nowPlayingState({}, [1]).kind, 'ready');
});
