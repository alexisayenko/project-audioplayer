import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
const { renderTheory, sortTerms, FAIL_TEXT, EMPTY_TEXT } = await import('./theory.js');
const file = JSON.parse(readFileSync(new URL('../data/theory-terms.json', import.meta.url), 'utf8'));

const textOf = (n) => (n.textContent ?? '');
const all = (n, tag, out = []) => {
  for (const c of n.children ?? []) { if (c.tagName?.toLowerCase() === tag) out.push(c); all(c, tag, out); }
  return out;
};
const mount = async (handler) => {
  stubFetch(handler);
  const root = document.createElement('div');
  renderTheory(root);
  await flush();
  await flush();
  return root;
};

test('data file: unique ids, alphabetical sort, exactly the three terms', () => {
  const ids = file.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(sortTerms([...file]).map((t) => t.id), ['british-invasion', 'drum-machine', 'syncopation']);
  for (const t of file) assert.ok(t.term && t.description);
});

test('renders the heading and the terms from the json in alphabetical order', async () => {
  const root = await mount(() => ({ body: [file[2], file[0], file[1]] }));
  assert.equal(textOf(all(root, 'h1')[0]), 'Music theory');
  assert.equal(all(root, 'dl').length, 1);
  assert.deepEqual(all(root, 'dt').map(textOf), ['British Invasion', 'Drum machine', 'Syncopation']);
  assert.equal(all(root, 'dd').length, 3);
  assert.match(textOf(all(root, 'dd')[2]), /off-beats/);
});

test('shows a message when the load fails', async () => {
  const root = await mount(() => ({ status: 500, body: {} }));
  assert.ok(textOf(root).includes(FAIL_TEXT));
  assert.equal(all(root, 'dl').length, 0);
});

test('shows a message when the list is empty', async () => {
  const root = await mount(() => ({ body: [] }));
  assert.ok(textOf(root).includes(EMPTY_TEXT));
});
