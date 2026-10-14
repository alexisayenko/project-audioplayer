import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './test-dom.mjs';

installDom();
const { store, tagCounts } = await import('./store.js');

test('tagCounts counts canonical tags once per song, case-insensitively, sorted', () => {
  const songs = [
    { tags: ['Rock', 'rock', 'jazz'] },
    { tags: ['ROCK'] },
    { tags: [] },
    { tags: ['Jazz'] },
  ];
  const c = tagCounts(songs);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.count), [2, 2]);
  assert.deepEqual(c.map((x) => x.tag.toLowerCase()), ['jazz', 'rock']);
  assert.deepEqual(tagCounts([]), []);
});

test('refresh loads songs, derives tags, notifies subscribers; unsubscribe works', async () => {
  stubFetch(() => ({ body: { songs: [{ id: 'a', tags: ['pop'] }, { id: 'b', tags: ['pop'] }] } }));
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  await store.refresh();
  assert.equal(store.loaded, true);
  assert.equal(store.get('b').id, 'b');
  assert.equal(store.get('zzz'), undefined);
  assert.equal(store.tags[0].count, 2);
  assert.equal(n, 1);
  off();
  await store.refresh();
  assert.equal(n, 1);
});

test('refresh failure leaves previous songs and does not notify', async () => {
  stubFetch(() => ({ status: 503, body: { detail: 'down' } }));
  const before = store.songs;
  let n = 0;
  store.subscribe(() => { n += 1; });
  await assert.rejects(() => store.refresh());
  assert.equal(store.songs, before);
  assert.equal(n, 0);
});
