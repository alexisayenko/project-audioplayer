import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { initPlayer } = await import('./player.js');
initPlayer();
const { openSongCard, liveBpm, resetLiveBpmForTests } = await import('./song-card.js');
const { LIVE_BPM_KEY } = await import('./live-bpm-ctl.js');

const SONG = { id: 'a', title: 'Alpha', artist: 'Zed', bpm: 139.2, file: 'a.mp3', tags: [] };
const NOBPM = { id: 'b', title: 'Beta', file: 'b.mp3', tags: [] };
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const badge = () => document.getElementById('song-card').querySelector('.bpm-badge');

test('the BPM badge is a toggle button, off by default', () => {
  localStorage.removeItem(LIVE_BPM_KEY);
  resetLiveBpmForTests();
  publish([SONG]);
  openSongCard(SONG);
  const b = badge();
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.getAttribute('type'), 'button');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(b.getAttribute('aria-label'), 'BPM 139');
  assert.ok(b.textContent.startsWith('139'));
  assert.ok(!b.classList.contains('on'));
  document.getElementById('song-card').close();
});

test('clicking turns live mode on, persists it, shows the stored value with ~ until locked', () => {
  resetLiveBpmForTests();
  publish([SONG]);
  openSongCard(SONG);
  badge().click();
  const b = badge();
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.ok(b.classList.contains('on'));
  assert.ok(b.textContent.startsWith('~139'));
  assert.equal(localStorage.getItem(LIVE_BPM_KEY), '1');
  document.getElementById('song-card').close();
});

test('the state is global: a freshly opened card of another song starts in the saved mode', () => {
  const other = { ...SONG, id: 'c', bpm: 90 };
  publish([SONG, other]);
  resetLiveBpmForTests();
  openSongCard(other);
  assert.equal(badge().getAttribute('aria-pressed'), 'true');
  badge().click();
  assert.equal(badge().getAttribute('aria-pressed'), 'false');
  assert.equal(localStorage.getItem(LIVE_BPM_KEY), '0');
  assert.ok(badge().textContent.startsWith('90'));
  document.getElementById('song-card').close();
});

test('a song without BPM has no badge', () => {
  publish([NOBPM]);
  openSongCard(NOBPM);
  assert.equal(badge(), null);
  document.getElementById('song-card').close();
  liveBpm().setOn(false);
});
