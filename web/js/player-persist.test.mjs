import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

const dom = await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
localStorage.setItem('ap2.queue', JSON.stringify({ items: [{ id: 'b', manual: true, tags: [] }, { id: 'gone', manual: true, tags: [] }, { id: 'a', manual: true, tags: [] }], index: 0, tags: [] }));
localStorage.setItem('ap2.shuffle', '1');
localStorage.setItem('ap2.repeat', 'all');
localStorage.setItem('ap2.volume', '0.25');
const calls = stubFetch((url, o) => {
  if (o.method === 'POST' && /\/audio$/.test(url)) return { body: { status: 'done' } };
  return { body: { songs: [] } };
});
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
const { setAutoDownload } = await import('./autodl.js');

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const SONGS = [
  { id: 'a', title: 'Alpha', file: 'a.mp3', tags: [] },
  { id: 'b', title: 'Beta', file: 'b.mp3', tags: [] },
  { id: 'n', title: 'NoAudio', file: null, audio_state: 'none', tags: [] },
];
const publish = (songs) => { store.songs = songs; store.tags = []; store.loaded = true; store.listeners.forEach((fn) => fn()); };

test('saved queue, shuffle, repeat and volume are restored on init', () => {
  initPlayer();
  assert.equal(audio.volume, 0.25);
  assert.equal($('mini-volume').value, 25);
  assert.equal($('mini-shuffle').getAttribute('aria-pressed'), 'true');
  assert.match($('mini-repeat').getAttribute('aria-label'), /whole list/);
  assert.equal(player.current, null, 'library not loaded yet: nothing current');
});

test('when the library arrives the queue is reconciled: unknown ids dropped, current loaded but not auto-played', () => {
  publish(SONGS);
  assert.equal(player.current.id, 'b');
  assert.equal(audio.getAttribute('src'), '/files/b');
  assert.equal(audio.plays, 0, 'a restored queue never starts playing by itself');
  assert.equal($('queue-list').children.length, 2);
  const saved = JSON.parse(localStorage.getItem('ap2.queue'));
  assert.deepEqual(saved.items.map((i) => i.id), ['b', 'a']);
});

test('with auto-download on, songs without audio become queueable and are requested', async () => {
  assert.equal(player.add('n'), 'unavailable');
  setAutoDownload(true);
  assert.equal(player.add('n'), 'added');
  player.autoDownloadChanged();
  await flush();
  assert.ok(calls.some((c) => c.url === '/songs/n/audio' && c.opts.method === 'POST'));
  assert.equal($('queue-list').children.length, 3);
  setAutoDownload(false);
  player.autoDownloadChanged();
});

test('failing localStorage never breaks queue operations', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.doesNotThrow(() => { player.playNow('a'); player.setShuffle(false); player.cycleRepeat(); });
  assert.equal(player.current.id, 'a');
  globalThis.localStorage = real;
});

test('the window auth-changed pause is wired through pausePlayer', async () => {
  const { pausePlayer } = await import('./player.js');
  audio.play();
  assert.equal(audio.paused, false);
  pausePlayer();
  assert.equal(audio.paused, true);
  dom.window.dispatch('noop');
});
