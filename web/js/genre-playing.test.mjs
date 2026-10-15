import test from 'node:test';
import assert from 'node:assert/strict';
import { songGenres, mapToNodes, nodeIds, nowPlayingState, createNowSelection, nowSelectionMessage, orphanNodes, orphanState } from './genre-playing.js';

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
  assert.equal(nowPlayingState({}, []).hint, 'No genres for this song');
  assert.equal(nowPlayingState({}, [{ id: null }]).kind, 'unmapped');
  assert.equal(nowPlayingState({}, [{ id: 'Q1' }]).kind, 'ready');
});

function fakeMap() {
  const m = { sel: [], announced: [] };
  m.ctl = createNowSelection({
    setSelection: (ids) => { m.sel = [...ids]; m.ctl.userSelected(); },
    clearSelection: () => { m.sel = []; m.ctl.userSelected(); },
    announce: (t) => m.announced.push(t),
  });
  m.tapDot = (id) => { m.sel = [id]; m.ctl.userSelected(); };
  m.tapEmpty = () => { m.sel = []; m.ctl.userSelected(); };
  return m;
}

test('now playing selects all genres of the song and announces it', () => {
  const m = fakeMap();
  assert.equal(m.ctl.toggle(['a', 'b', 'c']), true);
  assert.deepEqual(m.sel, ['a', 'b', 'c']);
  assert.equal(m.ctl.active, true);
  assert.deepEqual(m.announced, ['Selected 3 genres of the playing song']);
  assert.equal(nowSelectionMessage(1), 'Selected 1 genre of the playing song');
});

test('empty click clears the selection and un-presses', () => {
  const m = fakeMap();
  m.ctl.toggle(['a', 'b']);
  m.tapEmpty();
  assert.deepEqual(m.sel, []);
  assert.equal(m.ctl.active, false);
});

test('another dot replaces the selection and un-presses', () => {
  const m = fakeMap();
  m.ctl.toggle(['a', 'b']);
  m.tapDot('z');
  assert.deepEqual(m.sel, ['z']);
  assert.equal(m.ctl.active, false);
});

test('pressing again toggles it off and clears', () => {
  const m = fakeMap();
  m.ctl.toggle(['a', 'b']);
  assert.equal(m.ctl.toggle(['a', 'b']), false);
  assert.deepEqual(m.sel, []);
  assert.equal(m.ctl.active, false);
});

test('song change follows while active, ignores identical genres, clears when none', () => {
  const m = fakeMap();
  m.ctl.toggle(['a', 'b']);
  m.ctl.songChanged(['a', 'b']);
  assert.equal(m.announced.length, 1);
  m.ctl.songChanged(['c']);
  assert.deepEqual(m.sel, ['c']);
  assert.equal(m.ctl.active, true);
  m.ctl.songChanged([]);
  assert.deepEqual(m.sel, []);
  assert.equal(m.ctl.active, false);
});

test('song change does nothing when not active; no genres cannot activate', () => {
  const m = fakeMap();
  m.ctl.songChanged(['a']);
  assert.deepEqual(m.sel, []);
  assert.equal(m.ctl.toggle([]), false);
  assert.equal(m.ctl.active, false);
});

test('a plain user selection is unaffected', () => {
  const m = fakeMap();
  m.tapDot('x');
  assert.deepEqual(m.sel, ['x']);
  assert.equal(m.ctl.userSelected(), false);
});

test('orphanNodes: zero edges, self-loop only, hidden neighbours, empty graph', () => {
  const nodes = [
    { id: 'A', label: 'A', count: 1 }, { id: 'B', label: 'B', count: 5 }, { id: 'C', label: 'C', count: 5 },
    { id: 'D', label: 'D', count: 2 }, { id: 'E', label: 'E', count: 0 },
  ];
  const edges = [{ source: 'B', target: 'B' }, { source: 'D', target: 'E' }];
  assert.deepEqual(orphanNodes({ nodes, edges }).map((n) => n.id), ['B', 'C', 'A']);
  assert.deepEqual(orphanNodes({ nodes, edges: [{ source: 'A', target: 'GONE' }] }).map((n) => n.id), ['B', 'C', 'D', 'E']);
  assert.deepEqual(orphanNodes({ nodes: [], edges: [] }), []);
  assert.deepEqual(orphanNodes(null), []);
});

test('orphanState labels the count and disables with none', () => {
  assert.deepEqual(orphanState(25), { disabled: false, hint: 'Genres with no connections', label: 'Orphans 25' });
  assert.equal(orphanState(0).disabled, true);
  assert.equal(orphanState(0).hint, 'No orphan genres');
});
