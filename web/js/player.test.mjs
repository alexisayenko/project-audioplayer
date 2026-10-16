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
  { id: 'a', title: 'Alpha', artist: 'AA', file: 'a.mp3', tags: ['rock'], duration: 100, cover: true, bpm: 120.4 },
  { id: 'b', title: 'Beta', artist: 'BB', file: 'b.mp3', tags: ['jazz'], duration: 200 },
  { id: 'n', title: 'NoAudio', artist: 'NN', file: null, audio_state: 'none', tags: [] },
  { id: 'c', title: 'Gamma', file: 'c.mp3', tags: ['rock'], duration: 300 },
];
const publish = (songs) => { store.songs = songs; store.tags = [{ tag: 'rock', count: 2 }, { tag: 'jazz', count: 1 }]; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const queueTitles = () => $('queue-list').children.map((li) => li.querySelector('.open').textContent);
const saved = () => JSON.parse(localStorage.getItem('ap2.queue'));
const reset = () => { for (let i = player.current ? 50 : 0; i > 0; i -= 1) player.removeAt(0); };

initPlayer();
publish(SONGS);

test('empty player: nothing playing, controls disabled, mini hidden', () => {
  assert.equal(player.current, null);
  assert.equal($('mini').hidden, true);
  assert.equal($('mini-prev').disabled, true);
  assert.equal($('queue-empty').hidden, false);
  assert.equal($('queue-clear').disabled, true);
  assert.equal(document.title, 'Electrophone');
});

test('playNow loads the file, plays, and fills mini/full player details', () => {
  player.playNow('a');
  assert.equal(audio.getAttribute('src'), '/files/a');
  assert.equal(audio.plays, 1);
  assert.equal(player.current.id, 'a');
  assert.equal($('mini').hidden, false);
  assert.equal($('mini-title').textContent, 'Alpha');
  assert.equal($('player-title').textContent, 'Alpha');
  assert.equal($('player-bpm').textContent, '120 BPM');
  assert.equal(document.title, 'Alpha - Electrophone');
  assert.equal($('mini-play').getAttribute('aria-label'), 'Pause');
  assert.equal(player.playing, true);
  assert.deepEqual(queueTitles(), ['Alpha']);
  assert.equal(saved().items[0].id, 'a', 'queue persisted');
});

test('songs without audio cannot be queued while auto-download is off', () => {
  assert.equal(player.add('n'), 'unavailable');
  assert.equal(player.add('zzz'), 'unavailable');
  player.playNow('n');
  assert.equal(player.current.id, 'a');
});

test('add returns added/duplicate; toggleInPlaylist adds and removes', () => {
  assert.equal(player.add('b'), 'added');
  assert.equal(player.add('b'), 'duplicate');
  assert.equal(player.inQueue('b'), true);
  assert.equal(player.toggleInPlaylist('b'), 'removed');
  assert.equal(player.inQueue('b'), false);
  assert.equal(player.toggleInPlaylist('b'), 'added');
  player.add('c');
  assert.deepEqual(queueTitles(), ['Alpha', 'Beta', 'Gamma']);
});

test('next/prev walk the queue; prev restarts when past 3 s', () => {
  player.next();
  assert.equal(player.current.id, 'b');
  assert.equal(audio.getAttribute('src'), '/files/b');
  audio.currentTime = 10;
  player.prev();
  assert.equal(audio.currentTime, 0, 'restarts the song');
  assert.equal(player.current.id, 'b');
  player.prev();
  assert.equal(player.current.id, 'a');
  player.prev();
  assert.equal(player.current.id, 'a', 'nothing before the first song');
});

test('at the end of the queue Next is disabled; auto-advance stops', () => {
  player.playAt(2);
  assert.equal($('mini-next').disabled, true);
  const before = audio.plays;
  audio.dispatchEvent(makeEvent('ended'));
  assert.equal(player.current.id, 'c');
  assert.equal(audio.plays, before);
});

test('repeat cycles off -> all -> one -> off and labels follow', () => {
  assert.match($('mini-repeat').getAttribute('aria-label'), /off/);
  player.cycleRepeat();
  assert.match($('mini-repeat').getAttribute('aria-label'), /whole list/);
  assert.equal($('mini-repeat').getAttribute('aria-pressed'), 'true');
  player.cycleRepeat();
  assert.match($('mini-repeat').getAttribute('aria-label'), /one song/);
  assert.equal(localStorage.getItem('ap2.repeat'), 'one');
  player.cycleRepeat();
  assert.equal(localStorage.getItem('ap2.repeat'), 'off');
});

test('repeat all wraps on auto-advance; repeat one restarts the song', () => {
  player.cycleRepeat();
  audio.dispatchEvent(makeEvent('ended'));
  assert.equal(player.current.id, 'a');
  player.cycleRepeat();
  const plays = audio.plays;
  audio.dispatchEvent(makeEvent('ended'));
  assert.equal(player.current.id, 'a');
  assert.equal(audio.plays, plays + 1);
  player.cycleRepeat();
});

test('shuffle toggles, persists, and visits every song once', () => {
  player.setShuffle(true);
  assert.equal(localStorage.getItem('ap2.shuffle'), '1');
  assert.equal($('mini-shuffle').getAttribute('aria-pressed'), 'true');
  player.playAt(0);
  const seen = new Set([player.current.id]);
  for (let i = 0; i < 2; i += 1) { player.next(); seen.add(player.current.id); }
  assert.equal(seen.size, 3);
  player.setShuffle(false);
  assert.equal(localStorage.getItem('ap2.shuffle'), '0');
});

test('move reorders without changing the current song', () => {
  player.playAt(0);
  player.move(0, 1);
  assert.deepEqual(queueTitles(), ['Beta', 'Alpha', 'Gamma']);
  assert.equal(player.current.id, 'a');
  player.move(1, -1);
  assert.deepEqual(queueTitles(), ['Alpha', 'Beta', 'Gamma']);
  player.move(0, -1);
  assert.deepEqual(queueTitles(), ['Alpha', 'Beta', 'Gamma']);
});

test('removing the current song loads the next one; removing the last empties the player', () => {
  player.playAt(0);
  player.removeAt(0);
  assert.equal(player.current.id, 'b');
  assert.deepEqual(queueTitles(), ['Beta', 'Gamma']);
  player.removeAt(1);
  player.removeAt(0);
  assert.equal(player.current, null);
  assert.equal(audio.paused, true);
  assert.equal($('mini').hidden, true);
  assert.equal(saved().items.length, 0);
});

test('playListed replaces the queue and reports skipped no-audio songs', () => {
  const r = player.playListed(store.songs, []);
  assert.equal(r.count, 3);
  assert.equal(r.skipped, 1);
  assert.equal(player.current.id, 'a');
  assert.equal(player.playListed([store.songs[2]], []).count, 0);
});

test('addTags adds every song with the tag and shows a removable chip', () => {
  reset();
  assert.equal(player.addTags(['rock']), 2);
  assert.deepEqual(queueTitles(), ['Alpha', 'Gamma']);
  assert.equal($('fill-tags').children.length, 1);
  $('fill-tags').querySelector('.x').click();
  assert.deepEqual(queueTitles(), ['Alpha']);
});

test('Clear drops upcoming songs and disables itself', () => {
  reset();
  player.add('a');
  player.add('b');
  player.add('c');
  assert.equal($('queue-clear').disabled, false);
  $('queue-clear').click();
  assert.deepEqual(queueTitles(), ['Alpha']);
  assert.equal($('queue-clear').disabled, true);
});

test('keyboard: space toggles, arrows seek, typing in inputs is ignored', () => {
  reset();
  player.playNow('a');
  audio.pause();
  audio.duration = 100;
  audio.currentTime = 20;
  const key = (k, target = document.body) => { const e = makeEvent('keydown', { key: k, target }); document.dispatchEvent(e); return e; };
  assert.equal(key(' ').defaultPrevented, true);
  assert.equal(audio.paused, false);
  key('ArrowRight');
  assert.equal(audio.currentTime, 25);
  key('ArrowLeft');
  key('ArrowLeft');
  assert.equal(audio.currentTime, 15);
  const input = document.createElement('input');
  document.body.append(input);
  assert.equal(key(' ', input).defaultPrevented, false);
  assert.equal(key(' ', document.body).defaultPrevented, true);
  assert.equal(document.dispatchEvent(makeEvent('keydown', { key: 'ArrowRight', ctrlKey: true, target: document.body })), true);
});

test('seek clamps to the duration and ignores an unknown duration', () => {
  audio.duration = 100;
  player.seek(500);
  assert.equal(audio.currentTime, 100);
  player.seek(-5);
  assert.equal(audio.currentTime, 0);
  audio.duration = NaN;
  audio.currentTime = 7;
  player.seek(50);
  assert.equal(audio.currentTime, 7);
});

test('volume input persists and clamps', () => {
  const v = $('mini-volume');
  v.value = '40';
  v.dispatchEvent(makeEvent('input', { target: v }));
  assert.equal(audio.volume, 0.4);
  assert.equal(localStorage.getItem('ap2.volume'), '0.4');
  v.value = '400';
  v.dispatchEvent(makeEvent('input', { target: v }));
  assert.equal(audio.volume, 1);
});

test('toggleMute mutes and unmutes; Now playing has no speaker button of its own', () => {
  assert.equal($('p-mute'), null);
  player.toggleMute();
  assert.equal(audio.muted, true);
  player.toggleMute();
  assert.equal(audio.muted, false);
});

test('a song deleted from the library leaves the queue and stops playback', () => {
  player.playNow('b');
  publish(SONGS.filter((s) => s.id !== 'b'));
  assert.ok(!queueTitles().includes('Beta'));
  assert.notEqual(player.current?.id, 'b');
});

test('audio error toasts; pausePlayer stops and drops the source', () => {
  player.playNow('a');
  audio.dispatchEvent(makeEvent('error'));
  assert.equal($('toast').textContent, 'Cannot play this song');
  pausePlayer();
  assert.equal(audio.paused, true);
  assert.equal(audio.getAttribute('src'), null);
});

test('song menu offers Move/Remove and edits through the dialog', () => {
  reset();
  player.add('a');
  player.add('c');
  $('queue-list').children[0].querySelector('.more').click();
  const items = document.body.querySelectorAll('.menu button').map((b) => b.textContent);
  assert.ok(items.includes('Edit song') && items.includes('Remove') && items.includes('Download'));
  assert.equal(document.body.querySelectorAll('.menu button').find((b) => b.textContent === 'Move up').disabled, true);
  document.body.querySelectorAll('.menu button').find((b) => b.textContent === 'Remove').click();
  assert.deepEqual(queueTitles(), ['Gamma']);
});

test('tag picker adds songs by tag and the Apply label counts new tags', () => {
  reset();
  $('tag-add').click();
  const dlg = $('edit-dialog');
  assert.equal(dlg.open, true);
  const apply = dlg.querySelectorAll('button').find((b) => /^Add songs/.test(b.textContent));
  assert.equal(apply.disabled, true);
  dlg.querySelectorAll('.chip').find((b) => b.getAttribute('title') === 'rock').click();
  assert.equal(apply.textContent, 'Add songs (1 tag)');
  apply.click();
  assert.equal(dlg.open, false);
  assert.deepEqual(queueTitles(), ['Alpha', 'Gamma']);
});
