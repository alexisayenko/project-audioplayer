import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const { store } = await import('./store.js');
const { songRow } = await import('./library-rows.js');
const { queueRow } = await import('./player-ui.js');

const song = { id: 'r1', title: 'Song', artist: 'Zed', remixer: 'Kav - Bob', file: 'r1.mp3', tags: [] };
const plain = { id: 'r2', title: 'Song (Kav Remix)', artist: 'Zed', remixer: 'Kav', file: 'r2.mp3', tags: [] };

test('library row shows the remix in a muted span, full text in tooltip and aria-label', () => {
  const row = songRow(song, null, null);
  const open = row.querySelector('.open');
  assert.equal(open.querySelector('.ttl').textContent, 'Song');
  assert.equal(open.querySelector('.rmx').textContent, '(Kav, Bob)');
  assert.match(open.getAttribute('aria-label'), /Song \(Kav, Bob\)/);
  assert.match(open.getAttribute('title'), /Song \(Kav, Bob\) - Zed/);
});

test('library row has no remix span when the title already holds it', () => {
  const row = songRow(plain, null, null);
  assert.equal(row.querySelector('.rmx'), null);
  assert.equal(row.querySelector('.open').textContent, 'Song (Kav Remix)');
});

test('queue row shows the remix span', () => {
  store.songs = [song, plain];
  store.loaded = true;
  const noop = () => {};
  const ctx = { count: 2, index: 0, move: noop, removeAt: noop, playAt: noop };
  const a = queueRow({ id: 'r1' }, 0, ctx);
  assert.equal(a.querySelector('.rmx').textContent, '(Kav, Bob)');
  const b = queueRow({ id: 'r2' }, 1, ctx);
  assert.equal(b.querySelector('.rmx'), null);
});

test('Track column width is one custom property', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /--track-w: 300px;/);
  assert.match(css, /minmax\(220px, var\(--track-w\)\)/);
  assert.match(css, /var\(--row-cover-size\) var\(--track-w\) minmax/);
  assert.doesNotMatch(css, /\b400px minmax|, 400px\)/);
});
