import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost', origin: 'http://localhost' };
stubFetch(() => ({ body: {} }));
const { store } = await import('./store.js');
const { openShared, applyVizOverrides, closeGate } = await import('./share-open.js');
const { copyText } = await import('./share-ui.js');
const { vizBackgroundOn, setVizBackground } = await import('./viz-settings.js');
const { getStyle } = await import('./viz-terrain-style.js');
const { storeGet, storeSet } = await import('./storage.js');

const toastText = () => document.getElementById('toast').textContent;
store.songs = [
  { id: 'a', title: 'Alpha', artist: 'Zed', file: 'a.mp3', duration: 100, tags: [] },
  { id: 'n', title: 'Silent', artist: 'Wu', file: null, audio_state: 'none', tags: [], sources: [] },
];
store.loaded = true;

test('unknown or invalid shared songs show the unavailable message', () => {
  assert.equal(openShared({ id: 'zzz', t: 0 }), false);
  assert.equal(toastText(), 'This song is not available');
  assert.equal(openShared('bad'), false);
});

test('a playable shared song shows the tap-to-play gate with the start time', () => {
  assert.equal(openShared({ id: 'a', t: 83, viz: null, style: null, bg: null, fs: false, cam: null }), true);
  assert.equal(location.hash, '#/playback');
  const btn = document.body.querySelector('.share-go');
  assert.equal(btn.textContent, 'Tap to play at 1:23');
  closeGate();
  assert.equal(document.body.querySelector('.share-go'), null);
});

test('shared visualizer settings do not overwrite stored preferences', () => {
  storeSet('ap2.viz.mode', 'bars');
  storeSet('ap2.viz.terrain.style', 'relief');
  setVizBackground(false);
  applyVizOverrides({ viz: 'ring', style: 'melody', bg: true, cam: null });
  assert.equal(getStyle(), 'melody');
  assert.equal(vizBackgroundOn(), true);
  assert.equal(storeGet('ap2.viz.mode'), 'bars');
  assert.equal(storeGet('ap2.viz.terrain.style'), 'relief');
  assert.equal(storeGet('ap2.viz.bg'), '0');
  setVizBackground(false);
  assert.equal(vizBackgroundOn(), false);
});

test('copyText falls back to a textarea and execCommand', async () => {
  let copied = null;
  const doc = {
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {}, set value(v) { copied = v; } }),
    body: { append() {} },
    execCommand: () => true,
  };
  assert.equal(await copyText('https://x/#/play/a', doc, {}), true);
  assert.equal(copied, 'https://x/#/play/a');
  assert.equal(await copyText('t', doc, { clipboard: { writeText: async () => {} } }), true);
});
