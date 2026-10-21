import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
const { auth } = await import('./api.js');
const { setGuest, clearGuest } = await import('./guest.js');
const { libraryTools, pendingText } = await import('./library-tools.js');

const idle = (o = {}) => ({ state: 'idle', candidates: 0, total: 0, done: 0, updated: 0, nothing: 0, failed: 0, skipped: 0, ...o });
const fetchWith = (meta, bpm) => stubFetch((url) => {
  if (url === '/me/backfill/metadata') return { body: idle({ candidates: meta }) };
  if (url === '/me/backfill/bpm') return { body: idle({ candidates: bpm }) };
  return { status: 404, body: {} };
});
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
};

test('pending text lists what is missing', () => {
  assert.equal(pendingText(0, 0), '');
  assert.equal(pendingText(1, 0), '1 song needs metadata');
  assert.equal(pendingText(3, 5), '3 songs need metadata, 5 songs need BPM');
});

test('absent for signed-out visitors and guests', () => {
  auth.email = '';
  assert.equal(libraryTools(memory()), null);
  auth.email = 'me@x.y';
  setGuest({ owner: 'Alex', capabilities: {} });
  assert.equal(libraryTools(memory()), null);
  clearGuest();
});

test('collapsed by default, toggles with aria and remembers the choice', async () => {
  auth.email = 'me@x.y';
  fetchWith(3, 5);
  const storage = memory();
  const root = libraryTools(storage);
  document.body.append(root);
  await flush();
  const toggle = root.querySelector('.lib-tools-btn');
  const body = root.querySelector('#lib-tools-body');
  assert.equal(toggle.getAttribute('aria-controls'), 'lib-tools-body');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(body.hidden, true);
  assert.equal(root.querySelector('.lib-tools-badge').textContent, '8');
  assert.equal(toggle.getAttribute('aria-label'), 'Library tools, 3 songs need metadata, 5 songs need BPM');
  assert.match(root.textContent, /3 downloaded songs have no metadata yet/);
  assert.match(root.textContent, /5 songs have audio but no BPM/);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(body.hidden, false);
  assert.equal(storage.m.get('ap2.panel.libTools'), '0');
  toggle.click();
  assert.equal(storage.m.get('ap2.panel.libTools'), '1');
  root.remove();
});

test('opens expanded when remembered and shows no badge when nothing is pending', async () => {
  auth.email = 'me@x.y';
  fetchWith(0, 0);
  const storage = memory();
  storage.setItem('ap2.panel.libTools', '0');
  const root = libraryTools(storage);
  document.body.append(root);
  await flush();
  assert.equal(root.querySelector('#lib-tools-body').hidden, false);
  assert.equal(root.querySelector('.lib-tools-badge').hidden, true);
  assert.equal(root.querySelector('.lib-tools-btn').getAttribute('aria-label'), 'Library tools');
  assert.equal(root.querySelectorAll('section.card').length, 2);
  root.remove();
  auth.email = '';
});
