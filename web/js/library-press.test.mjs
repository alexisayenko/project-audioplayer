import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const SONGS = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, artist: 'A', file: `s${i}.mp3`, duration: 100, added_at: `2024-01-${String(i + 1).padStart(2, '0')}`, tags: [] }));
stubFetch(() => ({ body: { songs: SONGS } }));
const { store } = await import('./store.js');
const { renderLibrary } = await import('./library.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();

store.songs = SONGS;
store.loaded = true;
store.pending = null;
store.loadedAt = Date.now();
store.tags = [];

const root = document.createElement('div');
document.body.append(root);
const cleanup = renderLibrary(root);
const rows = () => root.querySelectorAll('li.song');
const byId = () => new Map(rows().map((r) => [r.dataset.id, r]));
await flush();

test('LIB-283: a press rebuilds the row that stopped being current and the one that became current, never the rows whose queue position only moved', async () => {
  player.addListed(SONGS, '');
  await flush();
  assert.equal(player.currentId, 's0');
  const before = byId();
  const posBefore = player.queuePosition('s5').pos;
  player.playNow('s9');
  await flush();
  assert.equal(player.currentId, 's9');
  assert.notEqual(player.queuePosition('s5').pos, posBefore, 'the song moved in the queue');
  const after = byId();
  const rebuilt = SONGS.filter((s) => after.get(s.id) !== before.get(s.id)).map((s) => s.id);
  assert.deepEqual(rebuilt, ['s0', 's9']);
  assert.ok(after.get('s9').classList.contains('current'));
  assert.ok(!after.get('s0').classList.contains('current'));
});

test('LIB-283: the exact queue position is read when a row is pointed at or focused, not when it is built', async () => {
  const row = byId().get('s5');
  const cover = row.querySelector('.row-cover');
  assert.equal(cover.title, 'Play Song 5. In the queue', 'built with the short note');
  assert.equal(cover.getAttribute('aria-description'), 'In the queue');
  const { pos, total } = player.queuePosition('s5');
  row.dispatchEvent(makeEvent('pointerover', { bubbles: true }));
  assert.equal(cover.title, `Play Song 5. In the queue, position ${pos} of ${total}`);
  assert.equal(cover.getAttribute('aria-description'), `In the queue, position ${pos} of ${total}`);
  assert.equal(row.querySelector('.act-queue').title, `In the queue, position ${pos} of ${total}. Click to remove`);
  player.playNow('s12');
  await flush();
  const again = byId().get('s5');
  assert.equal(again, row, 'the row was not rebuilt');
  assert.equal(again.querySelector('.row-cover').title, `Play Song 5. In the queue, position ${pos} of ${total}`, 'stale until the pointer comes back');
  again.dispatchEvent(makeEvent('focusin', { bubbles: true }));
  const now = player.queuePosition('s5');
  assert.equal(again.querySelector('.row-cover').title, `Play Song 5. In the queue, position ${now.pos} of ${now.total}`);
});

test('a song that is not queued gets no note when pointed at', () => {
  player.toggleInPlaylist('s5');
  const fresh = byId().get('s5');
  assert.equal(fresh.querySelector('.row-cover.queued'), null);
  fresh.dispatchEvent(makeEvent('pointerover', { bubbles: true }));
  assert.equal(fresh.querySelector('.row-cover').title.includes('In the queue'), false);
  cleanup();
});
