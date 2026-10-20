import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer, pausePlayer } = await import('./player.js');

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const SONGS = [
  { id: 'a', title: 'Alpha', file: 'a.mp3', tags: [], duration: 100 },
  { id: 'b', title: 'Beta', file: 'b.mp3', tags: [], duration: 200 },
];
store.songs = SONGS;
store.loaded = true;
store.listeners.forEach((fn) => fn());
initPlayer();
audio.duration = 100;

test('PLY-160: the player owns the loop and the dock chip appears only while a loop is active', () => {
  player.playNow('a');
  assert.equal(player.loop.get().active, false);
  assert.equal($('mini-loop').hidden, true);
  player.loop.setRegion(12.3, 27.5, true);
  assert.equal($('mini-loop').hidden, false);
  assert.match($('mini-loop').textContent, /Loop A-B 0:12\.3 - 0:27\.5/);
  const off = $('mini-loop').querySelector('button');
  assert.equal(off.getAttribute('aria-label'), 'Turn loop off');
});

test('PLY-160: the chip off button turns the loop off, hides the chip and keeps the region', () => {
  $('mini-loop').querySelector('button').click();
  assert.equal(player.loop.get().on, false);
  assert.equal($('mini-loop').hidden, true);
  assert.deepEqual([player.loop.get().start, player.loop.get().end], [12.3, 27.5]);
});

test('PLY-160: the loop state survives pause and play and is cleared when the song changes', () => {
  player.loop.setOn(true);
  audio.pause();
  audio.play();
  assert.equal(player.loop.get().active, true);
  player.playNow('b');
  assert.deepEqual(player.loop.get(), { start: null, end: null, on: false, active: false });
  assert.equal($('mini-loop').hidden, true);
});

test('PLY-160: the position and duration getters read the audio element and play only plays a paused song', () => {
  audio.currentTime = 33;
  audio.duration = 200;
  assert.equal(player.position, 33);
  assert.equal(player.duration, 200);
  audio.pause();
  const before = audio.plays;
  player.play();
  assert.equal(audio.plays, before + 1);
  player.play();
  assert.equal(audio.plays, before + 1);
});

test('PLY-160: a loop that ends at the end of the file keeps the song from moving on when it ends', () => {
  audio.duration = 200;
  player.loop.setRegion(150, 200, true);
  audio.currentTime = 200;
  audio.dispatchEvent(makeEvent('ended'));
  assert.equal(player.current.id, 'b');
  assert.equal(audio.currentTime, 150);
});

test('PLY-160: pausePlayer (sign-out) clears the loop', () => {
  player.loop.setRegion(10, 20, true);
  pausePlayer();
  assert.equal(player.loop.get().on, false);
  assert.equal(player.loop.get().start, null);
});
