import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { openSongCard } = await import('./song-card.js');
const { setGuest, clearGuest } = await import('./guest.js');

const WITH = { id: 'a', title: 'Alpha', artist: 'Zed', file: 'a.mp3', cover: true, tags: [] };
const WITHOUT = { id: 'n', title: 'Bare', file: null, audio_state: 'none', tags: [] };
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const card = () => document.getElementById('song-card');
const changeBtn = () => card().querySelectorAll('button').filter((b) => b.getAttribute('aria-label') === 'Change cover');

test('the owner sees one Change cover button on the cover art', () => {
  clearGuest();
  publish([WITH]);
  openSongCard(WITH);
  const btns = changeBtn();
  assert.equal(btns.length, 1);
  assert.equal(btns[0].title, 'Change cover');
  assert.ok(card().querySelector('.card-art .cover-change'));
  card().close();
});

test('a song without a cover still offers Change cover', () => {
  clearGuest();
  publish([WITHOUT]);
  openSongCard(WITHOUT);
  assert.equal(changeBtn().length, 1);
  card().close();
});

test('guests never see Change cover', () => {
  setGuest({});
  publish([WITH]);
  openSongCard(WITH);
  assert.equal(changeBtn().length, 0);
  card().close();
  clearGuest();
});
