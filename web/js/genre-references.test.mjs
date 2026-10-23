import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
let owner = false;
let entries = [];
const calls = stubFetch((url, opts) => {
  if (url === '/me') return { body: { owner } };
  if (url === '/genres/references') return { body: { references: {}, by_song: {} } };
  if (url.startsWith('/genres/') && url.endsWith('/references') && (opts.method || 'GET') === 'GET') return { body: { genre: 'house', references: entries } };
  return { body: {} };
});
const R = await import('./references.js');
const { createReferencesPanel, EMPTY_REFERENCES, NOT_IN_LIBRARY, linkText } = await import('./genre-references.js');

const text = (n) => n.textContent;
const find = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const c of n.children || []) find(c, pred, out); return out; };
const byClass = (n, cls) => find(n, (x) => (x.className || '').split(' ').includes(cls));

const lib = { id: 'e1', artist: 'Frankie Knuckles', title: 'Your Love', year: 1987, role: 'origin', note: 'First deep house hit', reviewed: true, in_library: true, song_id: 's1', song: { id: 's1', title: 'Your Love', artist: 'Frankie Knuckles' }, sources: [{ type: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Your_Love' }, { type: 'rym', url: 'https://rateyourmusic.com/x' }], source_count: 2 };
const wish = { id: 'e2', artist: 'Marshall Jefferson', title: 'Move Your Body', role: 'archetype', reviewed: false, in_library: false, sources: [{ type: 'chart', url: 'https://charts.test/1' }, { type: 'other', url: 'https://www.youtube.com/watch?v=abc' }], source_count: 2 };
const bare = { id: 'e3', artist: 'X', title: 'Y', role: 'landmark', reviewed: true, in_library: false, sources: [], source_count: 0 };

async function shown(list, isOwner) {
  R.resetReferences();
  owner = isOwner;
  entries = list;
  const p = createReferencesPanel({ confirmFn: () => true });
  p.show('house');
  for (let i = 0; i < 4; i += 1) await flush();
  return p;
}

test('empty state', async () => {
  const p = await shown([], false);
  assert.equal(p.node.hidden, false);
  assert.match(text(p.node), new RegExp(EMPTY_REFERENCES));
  assert.equal(byClass(p.node, 'ref-add-btn').length, 0);
});

test('entries: role badge, line, note, play, add to library, marks, read-only for non-owners', async () => {
  const p = await shown([lib, wish, bare], false);
  const items = byClass(p.node, 'ref-item');
  assert.equal(items.length, 3);
  assert.match(text(items[0]), /Origin/);
  assert.match(text(items[0]), /Frankie Knuckles - Your Love \(1987\)/);
  assert.match(text(items[0]), /First deep house hit/);
  assert.equal(byClass(items[0], 'ref-play').length, 1);
  assert.equal(byClass(items[0], 'ref-verified').length, 1);
  assert.equal(byClass(items[0], 'ref-todo').length, 0);
  assert.match(text(items[0]), /2 sources/);
  assert.equal(byClass(items[0], 'ref-src-toggle')[0].title, 'Wikipedia, Rate Your Music');
  assert.equal(byClass(items[1], 'ref-add-lib').length, 1);
  assert.match(text(items[1]), /To review/);
  assert.equal(byClass(items[2], 'ref-add-lib').length, 0);
  assert.match(text(items[2]), new RegExp(NOT_IN_LIBRARY));
  assert.equal(byClass(items[2], 'ref-verified').length, 0);
  assert.equal(byClass(p.node, 'ref-owner').length, 0);
});

test('the owner sees edit controls and the add form button', async () => {
  const p = await shown([wish], true);
  assert.equal(byClass(p.node, 'ref-edit').length, 1);
  assert.equal(byClass(p.node, 'ref-del').length, 1);
  assert.equal(byClass(p.node, 'ref-review').length, 1);
  assert.equal(byClass(p.node, 'ref-add-btn').length, 1);
});

test('delete confirms and calls the API', async () => {
  const p = await shown([wish], true);
  byClass(p.node, 'ref-del')[0].click();
  for (let i = 0; i < 4; i += 1) await flush();
  assert.ok(calls.some((c) => c.opts.method === 'DELETE' && c.url === '/genres/house/references/e2'));
});

test('marking reviewed sends a PATCH', async () => {
  const p = await shown([wish], true);
  byClass(p.node, 'ref-review')[0].click();
  for (let i = 0; i < 4; i += 1) await flush();
  const c = calls.filter((x) => x.opts.method === 'PATCH').at(-1);
  assert.equal(c.url, '/genres/house/references/e2');
  assert.deepEqual(JSON.parse(c.opts.body), { reviewed: true });
});

test('hidden without a genre', async () => {
  const p = await shown([lib], false);
  p.show(null);
  assert.equal(p.node.hidden, true);
});

test('linkText shortens a link', () => {
  assert.equal(linkText('https://www.example.com/a/b'), 'example.com/a/b');
  assert.ok(linkText(`https://a.test/${'x'.repeat(80)}`).length <= 48);
});
