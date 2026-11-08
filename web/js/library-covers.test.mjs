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

test('WEB-122: the first rows jump the cover queue (at most 3 load at once); none is high priority', async () => {
  const { resetCoverLoader, coverLoadState } = await import('./cover-loader.js');
  resetCoverLoader();
  const rows = Array.from({ length: EAGER_COVERS + 5 }, (_, i) => {
    const li = row();
    li.querySelector('img.cover').dataset.src = `/covers/c${i}`;
    document.body.append(li);
    return li;
  });
  prioritizeCovers(rows);
  const imgs = rows.map((r) => r.querySelector('img.cover'));
  assert.deepEqual(imgs.slice(0, 3).map((i) => i.getAttribute('src')), ['/covers/c0', '/covers/c1', '/covers/c2']);
  assert.equal(imgs.filter((i) => i.getAttribute('src')).length, 3);
  assert.deepEqual(coverLoadState(), { paused: false, loading: 3, waiting: EAGER_COVERS - 3 });
  assert.ok(imgs.every((i) => i.getAttribute('fetchpriority') !== 'high'));
  assert.ok(imgs.every((i) => i.getAttribute('loading') === 'lazy'));
  resetCoverLoader();
});

test('WEB-122: rows without a cover image are skipped', () => {
  const li = document.createElement('li');
  prioritizeCovers([li]);
  assert.equal(li.querySelector('img'), null);
});
