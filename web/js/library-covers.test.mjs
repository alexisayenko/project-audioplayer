import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { prioritizeCovers } = await import('./library.js');
const { EAGER_COVERS } = await import('./constants.js');

const row = () => {
  const img = document.createElement('img');
  img.className = 'cover';
  img.setAttribute('loading', 'lazy');
  const li = document.createElement('li');
  li.append(img);
  return li;
};

test('WEB-122: the first rows get eager high-priority covers, the rest stay lazy', () => {
  const rows = Array.from({ length: EAGER_COVERS + 5 }, row);
  prioritizeCovers(rows);
  const imgs = rows.map((r) => r.querySelector('img.cover'));
  assert.ok(imgs.slice(0, EAGER_COVERS).every((i) => i.getAttribute('fetchpriority') === 'high' && i.loading === 'eager'));
  assert.ok(imgs.slice(EAGER_COVERS).every((i) => i.getAttribute('fetchpriority') === null && i.getAttribute('loading') === 'lazy'));
});

test('WEB-122: rows without a cover image are skipped', () => {
  const li = document.createElement('li');
  prioritizeCovers([li]);
  assert.equal(li.querySelector('img'), null);
});
