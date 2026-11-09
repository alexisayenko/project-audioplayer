import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const calls = stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
const { setGuest, clearGuest } = await import('./guest.js');

const SONGS = [
  { id: 's0', title: 'Zero', artist: 'A', file: 's0.mp3', duration: 100, tags: [] },
  { id: 's1', title: 'One', artist: 'A', file: 's1.mp3', duration: 100, tags: [] },
  { id: 's2', title: 'Two', artist: 'A', file: 's2.mp3', duration: 100, tags: [] },
  { id: 's4', title: 'Four', artist: 'A', file: 's4.mp3', duration: 100, tags: [] },
  { id: 's5', title: 'Five', artist: 'A', file: 's5.mp3', duration: 100, tags: [] },
  { id: 's6', title: 'Six', artist: 'A', file: 's6.mp3', duration: 100, tags: [] },
  { id: 'n3', title: 'No audio', artist: 'A', duration: 100, tags: [], audio_state: 'none' },
];
store.songs = SONGS;
store.loaded = true;
store.loadedAt = Date.now() + 1e9;
store.tags = [];
initPlayer();
const audio = document.getElementById('audio');
const fileCalls = () => calls.filter((c) => c.url.startsWith('/files/'));

test('PLY-209: prepare leaves the visible player state untouched and starts no playback', async () => {
  player.playNow('s0');
  await flush();
  const before = { src: audio.src, plays: audio.plays, id: player.currentId, title: document.getElementById('mini-title').textContent, paused: audio.paused };
  calls.length = 0;
  const cancel = player.prepare('s1');
  assert.equal(typeof cancel, 'function');
  await flush();
  assert.deepEqual(fileCalls().map((c) => [c.url, c.opts.headers.Range]), [['/files/s1', 'bytes=0-1']]);
  assert.deepEqual({ src: audio.src, plays: audio.plays, id: player.currentId, title: document.getElementById('mini-title').textContent, paused: audio.paused }, before);
});

test('PLY-209: prepare is skipped for the current song, a song without audio, and guests; repeats are rate limited', async () => {
  calls.length = 0;
  assert.equal(player.prepare('s0'), null);
  assert.equal(player.prepare('n3'), null);
  assert.equal(player.prepare('s1'), null, 'rate limited: s1 was prepared a moment ago');
  setGuest({});
  assert.equal(player.prepare('s2'), null);
  clearGuest();
  assert.equal(fileCalls().length, 0);
  assert.equal(typeof player.prepare('s2'), 'function');
});

test('PLY-211: the next queued song is probed once after 2 s of playing; not with shuffle', async () => {
  const realSet = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms === 2000) { timers.push(fn); return timers.length; } return realSet(fn, ms, ...a); };
  try {
    player.playListed([SONGS[0], SONGS[3]], []);
    await flush();
    calls.length = 0;
    audio.dispatchEvent(makeEvent('playing'));
    assert.equal(timers.length >= 1, true);
    assert.equal(fileCalls().length, 0, 'nothing before the 2 s');
    timers.splice(0).forEach((f) => f());
    assert.equal(player.peekNextId(), 's4');
    await flush();
    assert.deepEqual(fileCalls().map((c) => [c.url, c.opts.priority]), [['/files/s4', 'low']]);
    player.setShuffle(true);
    player.playNow('s2');
    await flush();
    calls.length = 0;
    audio.dispatchEvent(makeEvent('playing'));
    timers.splice(0).forEach((f) => f());
    await flush();
    assert.equal(fileCalls().length, 0, 'shuffle: the next song is unknowable');
  } finally {
    globalThis.setTimeout = realSet;
  }
});

test('PLY-214: starting another song ends the previous download and drops warm-ups for other songs', async () => {
  const realFetch = globalThis.fetch;
  const signals = {};
  globalThis.fetch = (url, opts = {}) => { signals[url] = opts.signal; return new Promise(() => {}); };
  const realLoad = audio.load;
  const events = [];
  audio.load = () => { events.push(`load src=${audio.getAttribute('src')}`); };
  try {
    player.playNow('s5');
    await flush();
    assert.match(audio.getAttribute('src'), /s5/);
    player.prepare('s6');
    events.length = 0;
    player.playNow('s6');
    await flush();
    assert.deepEqual(events, ['load src=null'], 'the unfinished download of s5 is ended before the new source is set');
    assert.match(audio.getAttribute('src'), /s6/);
    assert.equal(signals['/files/s6'].aborted, false, 'the warm-up for the song that starts is kept');
    player.prepare('s0');
    player.playNow('s5');
    await flush();
    assert.equal(signals['/files/s0'].aborted, true, 'a warm-up for another song is dropped');
  } finally {
    globalThis.fetch = realFetch;
    audio.load = realLoad;
  }
});
