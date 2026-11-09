import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { renderLibrary } = await import('./library.js');
const { player, initPlayer } = await import('./player.js');
await import('./library-toolbar.js');
await import('./song-card.js');

const N = 786;
const SONGS = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, artist: 'A', file: `s${i}.mp3`, duration: 100, added_at: `2024-01-01`, tags: ['genre:rock'] }));
store.songs = SONGS;
store.loaded = true;
store.loadedAt = Date.now() + 1e9;
store.tags = [{ tag: 'genre:rock', count: N }];
initPlayer();

const audio = document.getElementById('audio');
const root = document.createElement('div');
document.body.append(root);
renderLibrary(root);
const list = root.querySelector('ul.songs');
const rowOf = (id) => list.querySelector(`li.song[data-id="${id}"]`);
const snapshot = () => new Map(list.querySelectorAll('li.song').map((r) => [r.dataset.id, r]));
const changed = (before) => { const now = snapshot(); return [...before].filter(([id, r]) => now.get(id) !== r).map(([id]) => id); };

test('the Library list renders every song once', () => {
  assert.equal(list.querySelectorAll('li.song').length, N);
});

test('a play click starts audio.play() before any UI work and repaints at most the touched rows (PLY-207)', async () => {
  let replaceAll = 0;
  const nativeReplace = list.replaceChildren.bind(list);
  list.replaceChildren = (...a) => { replaceAll += 1; return nativeReplace(...a); };
  const before = snapshot();
  const seen = [];
  const nativePlay = audio.play;
  audio.play = () => {
    seen.push({ mini: document.getElementById('mini-title').textContent, replaceAll, sameRows: changed(before).length });
    return nativePlay();
  };
  rowOf('s3').querySelector('.row-cover').click();
  assert.equal(audio.plays > 0, true);
  assert.deepEqual(seen, [{ mini: '', replaceAll: 0, sameRows: 0 }], 'no mini-player, queue or list work ran before play()');
  assert.equal(document.getElementById('mini-title').textContent, '', 'UI work is deferred out of the click task');
  await flush();
  assert.equal(document.getElementById('mini-title').textContent, 'Song 3');
  assert.equal(replaceAll, 0, 'the list is never rebuilt as a whole');
  assert.deepEqual(changed(before), ['s3'], 'only the new current row was rebuilt');
  assert.equal(rowOf('s3').classList.contains('current'), true);
  assert.equal(rowOf('s3').querySelector('.row-cover').getAttribute('aria-label'), 'Pause Song 3');
  audio.play = nativePlay;
  list.replaceChildren = nativeReplace;
});

test('media events of one start collapse into at most one extra render and no list patch', async () => {
  await flush();
  const before = snapshot();
  let titles = 0;
  const mini = document.getElementById('mini-title');
  const nativeReplace = mini.replaceChildren.bind(mini);
  mini.replaceChildren = (...a) => { titles += 1; return nativeReplace(...a); };
  for (const ev of ['loadstart', 'play', 'playing', 'emptied', 'abort', 'loadstart', 'playing']) audio.dispatchEvent(makeEvent(ev));
  await flush();
  assert.equal(titles, 0, 'unchanged state renders nothing');
  assert.deepEqual(changed(before), []);
  mini.replaceChildren = nativeReplace;
});

test('timeupdate never renders the list, the queue or the mini-player', async () => {
  const before = snapshot();
  const queue = document.getElementById('queue-list');
  const rowsBefore = [...queue.children];
  audio.currentTime = 5;
  for (let i = 0; i < 20; i += 1) audio.dispatchEvent(makeEvent('timeupdate'));
  await flush();
  assert.deepEqual(changed(before), []);
  assert.deepEqual([...queue.children], rowsBefore);
});

test('pausing patches the playing row only', async () => {
  const before = snapshot();
  audio.pause();
  await flush();
  assert.deepEqual(changed(before), ['s3']);
  assert.equal(rowOf('s3').querySelector('.row-cover').getAttribute('aria-label'), 'Play Song 3');
  assert.equal(document.getElementById('mini-play').getAttribute('aria-label'), 'Play');
});

test('changing the current song patches exactly two rows', async () => {
  player.playNow('s3');
  await flush();
  const before = snapshot();
  player.playNow('s10');
  await flush();
  assert.deepEqual(changed(before).sort(), ['s10', 's3']);
  assert.equal(rowOf('s3').classList.contains('current'), false);
  assert.equal(rowOf('s3').getAttribute('aria-current'), null);
  assert.equal(rowOf('s10').classList.contains('current'), true);
  assert.equal(rowOf('s10').getAttribute('aria-current'), 'true');
  assert.equal(rowOf('s10').querySelector('.row-cover').getAttribute('aria-label'), 'Pause Song 10');
  assert.equal(rowOf('s3').querySelector('.row-cover').getAttribute('aria-label'), 'Play Song 3');
});

test('queueing a song patches that row only; the positions of the other queued rows are read when they are pointed at (LIB-283)', async () => {
  const before = snapshot();
  rowOf('s20').querySelector('.act-queue').click();
  await flush();
  assert.deepEqual(changed(before), ['s20']);
  assert.equal(rowOf('s20').querySelector('.act-queue').getAttribute('aria-pressed'), 'true');
  rowOf('s3').dispatchEvent(makeEvent('pointerover', { bubbles: true }));
  const q = player.queuePosition('s3');
  assert.match(rowOf('s3').querySelector('.row-cover').title, new RegExp(`position ${q.pos} of ${q.total}$`));
});
