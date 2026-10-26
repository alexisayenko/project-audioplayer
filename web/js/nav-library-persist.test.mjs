import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

const dom = await installPage();
globalThis.location = { hash: '#/library', href: 'http://localhost/', host: 'localhost' };
globalThis.history = { replaceState: (a, b, url) => { location.hash = url; } };
globalThis.setInterval = () => 0;
stubFetch((url) => {
  if (url === '/auth/me') return { body: { method: 'session', email: 'me@x.y', provider: 'google' } };
  if (url === '/library') return { body: { songs: [] } };
  if (url === '/albums') return { body: [] };
  if (url === '/drafts') return { body: { drafts: [], counts: { total: 0 }, limit: 500 } };
  return { body: {} };
});
const { auth } = await import('./api.js');
auth.email = 'me@x.y';
localStorage.setItem('electrophone.libraryView', 'albums');
await import('./app.js');
await flush();

const saved = () => localStorage.getItem('electrophone.libraryView');
const go = async (hash) => { location.hash = hash; dom.window.dispatch('hashchange'); await flush(); };

test('a bare #/library on the first load opens the remembered sub-item', () => {
  assert.equal(location.hash, '#/library/albums');
  assert.equal(document.body.dataset.route, 'library');
  assert.equal(document.getElementById('lib-albums').hidden, false);
  assert.equal(saved(), 'albums');
});

test('an explicit URL wins and is remembered', async () => {
  await go('#/library/drafts');
  assert.equal(location.hash, '#/library/drafts');
  assert.equal(document.getElementById('lib-drafts').hidden, false);
  assert.equal(saved(), 'drafts');
});

test('later navigation to #/library means Songs and is remembered as Songs', async () => {
  await go('#/library');
  assert.equal(location.hash, '#/library');
  assert.equal(document.getElementById('lib-songs').hidden, false);
  assert.equal(saved(), 'songs');
});

test('clicking the Library parent from another page goes to the last chosen sub-item', async () => {
  await go('#/library/albums');
  await go('#/playback');
  assert.equal(document.body.dataset.route, 'playback');
  fire(document.getElementById('library-toggle'), 'click');
  assert.equal(location.hash, '#/library/albums');
});

test('clicking the parent while already in the Library only toggles the menu', async () => {
  await go('#/library/drafts');
  fire(document.getElementById('library-toggle'), 'click');
  assert.equal(location.hash, '#/library/drafts');
});
