import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, makeEvent } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
localStorage.setItem('ap2.autodl', '1');
let failN = false;
var SONGS;
const calls = stubFetch((url, o) => {
  if (url === '/songs/n/audio' && o.method === 'POST') return failN ? { status: 500, body: { detail: 'yt-dlp failed' } } : { body: { status: 'running' } };
  if (url === '/songs/n/status') return { body: { state: 'done' } };
  return { body: { songs: SONGS } };
});
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');

const $ = (id) => document.getElementById(id);
const audio = $('audio');
SONGS = [
  { id: 'a', title: 'Alpha', file: 'a.mp3', tags: [] },
  { id: 'n', title: 'NoAudio', file: null, audio_state: 'none', tags: [] },
  { id: 'b', title: 'Beta', file: 'b.mp3', tags: [] },
];
initPlayer();
store.songs = SONGS;
store.loaded = true;
store.listeners.forEach((fn) => fn());

test('with auto-download on, any song can be queued and the missing audio is requested', async () => {
  assert.equal(player.add('a'), 'queued');
  assert.equal(player.add('n'), 'added');
  assert.equal(player.add('b'), 'added');
  await flush();
  assert.ok(calls.some((c) => c.url === '/songs/n/audio' && c.opts.method === 'POST'), 'queued song without audio is fetched in the background');
  assert.equal($('queue-list').children.length, 3);
  assert.ok($('queue-list').children[1].classList.contains('no-audio'));
});

test('Next lands on a not-yet-downloaded song and the player shows the download state', async () => {
  player.playNow('a');
  player.next();
  assert.equal(player.current.id, 'n');
  assert.equal($('player-dl').hidden, false);
  assert.equal(audio.getAttribute('src'), null);
  assert.equal($('p-download').hidden, true);
});

test('a failed download of the awaited song toasts and moves on', async () => {
  const { autodl: ad } = await import('./autodl.js');
  for (let i = 0; i < 60 && ad.view('n').kind !== 'none'; i += 1) await new Promise((r) => setTimeout(r, 50));
  failN = true;
  const { autodl } = await import('./autodl.js');

  autodl.request(['n'], { front: true });
  for (let i = 0; i < 5; i += 1) await flush();
  assert.match($('toast').textContent, /Could not download "NoAudio"|Skipped/);
});

test('toggle on a song without audio requests it (auto on) instead of playing', async () => {
  failN = false;
  player.playNow('n');
  assert.equal(player.current.id, 'n');
  player.toggle();
  assert.equal(audio.paused, true);
});

test('turning auto-download off prunes pending downloads and hides nothing in the queue', () => {
  localStorage.setItem('ap2.autodl', '0');
  player.autoDownloadChanged();
  assert.equal($('queue-list').children.length, 3);
});

test('prev skips songs without audio when auto-download is off', () => {
  player.playNow('b');
  audio.currentTime = 0;
  player.prev();
  assert.equal(player.current.id, 'a', 'stepped over the not-downloaded song');
  assert.match($('toast').textContent, /Skipped 1 not downloaded/);
});

test('media keys: mini buttons drive the same actions', () => {
  player.playNow('a');
  $('mini-next').click();
  assert.equal(player.current.id !== 'a', true);
  $('mini-prev').click();
  $('mini-shuffle').click();
  assert.equal($('mini-shuffle').getAttribute('aria-pressed'), 'true');
  $('mini-repeat').click();
  assert.match($('mini-repeat').getAttribute('aria-label'), /whole list/);
  assert.equal($('mini-open').getAttribute('aria-label'), 'Song info');
  for (const hash of ['#/library', '#/settings']) {
    location.hash = hash;
    $('song-card').close?.();
    $('mini-open').click();
    assert.equal($('song-card').open, true, `the dock title opens the song card on ${hash}`);
    assert.equal(location.hash, hash, 'it does not navigate');
    $('song-card').close?.();
  }
  audio.dispatchEvent(makeEvent('pause'));
});
