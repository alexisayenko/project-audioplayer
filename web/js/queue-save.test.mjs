import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer, flushQueue } = await import('./player.js');

const SONGS = [
  { id: 'a', title: 'Alpha', file: 'a.mp3', tags: [] },
  { id: 'b', title: 'Beta', file: 'b.mp3', tags: [] },
];
store.songs = SONGS;
store.loaded = true;
initPlayer();
const stored = () => JSON.parse(localStorage.getItem('ap2.queue') || 'null');

test('PLY-215: a press does not write the queue; it is written a moment later, once, with the latest state', async () => {
  const writes = [];
  const real = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => { if (k === 'ap2.queue') writes.push(v); real(k, v); };
  player.playNow('a');
  player.add('b');
  player.playNow('b');
  assert.deepEqual(writes, [], 'nothing is serialized inside the press');
  await flush();
  assert.deepEqual(writes, [], 'not even in the next task');
  flushQueue();
  assert.equal(writes.length, 1, 'one write for the three changes');
  assert.deepEqual(stored().items.map((i) => i.id), ['a', 'b']);
  assert.equal(stored().index, 1);
  flushQueue();
  assert.equal(writes.length, 1, 'nothing pending: no second write');
  localStorage.setItem = real;
});

test('PLY-215: leaving the page writes a pending queue at once', () => {
  player.playNow('a');
  assert.deepEqual(stored().items.map((i) => i.id), ['a', 'b'], 'the old state is still stored');
  window.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(stored().items.map((i) => i.id), ['b', 'a']);
});
