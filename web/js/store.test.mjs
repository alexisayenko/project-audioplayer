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

test('insert appends a song (replacing the same id), refreshes tags and notifies', () => {
  store.songs = [{ id: 'a', tags: ['pop'] }];
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  store.insert({ id: 'b', tags: ['pop'] });
  store.insert({ id: 'b', tags: ['rock'] });
  off();
  assert.deepEqual(store.songs.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(store.tags.map((t) => t.tag).sort(), ['pop', 'rock']);
  assert.equal(n, 2);
});

test('WEB-116: concurrent refreshes share one request; maxAgeMs skips a fresh library', async () => {
  const calls = stubFetch(() => ({ body: { songs: [{ id: 'a', tags: [] }] } }));
  store.loaded = false;
  store.pending = null;
  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(calls.length, 1);
  await store.refresh({ maxAgeMs: 60000 });
  assert.equal(calls.length, 1, 'fresh data is not fetched again');
  await store.refresh();
  assert.equal(calls.length, 2, 'a plain refresh always fetches');
  store.loadedAt -= 120000;
  await store.refresh({ maxAgeMs: 60000 });
  assert.equal(calls.length, 3, 'stale data is fetched again');
});

test('a background refresh that returns the same library does not notify; a changed one does; a plain refresh always does', async () => {
  const songs = [{ id: 'a', tags: ['pop'] }, { id: 'b', tags: [] }];
  let body = songs;
  stubFetch(() => ({ body: { songs: body } }));
  store.loaded = false;
  store.pending = null;
  await store.refresh();
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  store.loadedAt = 0;
  const first = store.songs;
  await store.refresh({ maxAgeMs: 1 });
  assert.equal(n, 0, 'identical data is not announced');
  assert.equal(store.songs, first);
  assert.ok(store.loadedAt > 0, 'but it counts as fresh');
  body = [...songs, { id: 'c', tags: [] }];
  store.loadedAt = 0;
  await store.refresh({ maxAgeMs: 1 });
  assert.equal(n, 1);
  assert.equal(store.songs.length, 3);
  await store.refresh();
  assert.equal(n, 2, 'a plain refresh always announces');
  store.insert({ id: 'd', tags: [] });
  store.loadedAt = 0;
  body = [...body, { id: 'd', tags: [] }];
  await store.refresh({ maxAgeMs: 1 });
  assert.equal(n, 4, 'insert invalidates the signature');
  off();
});
