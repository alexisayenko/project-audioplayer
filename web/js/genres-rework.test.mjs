import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { VOCAB, SONGS } = await import('./genre-levels-fixture.mjs');
let mode = 'ok';
const calls = stubFetch((u) => {
  if (mode === 'fail') return { status: 500, body: { error: 'x' } };
  if (u.includes('vocabulary')) {
    if (mode === 'vocab-fail') return { status: 500, body: { error: 'x' } };
    if (mode === 'old') return { body: { families: ['Electronic'], genres: [] } };
    return { body: VOCAB };
  }
  if (mode === 'lib-fail') return { status: 500, body: { error: 'x' } };
  return { body: { songs: SONGS } };
});
const { renderGenresRework } = await import('./genres-rework.js');
const { ICONS } = await import('./icons.js');
const { prefs } = await import('./library-data.js');

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root);
  await flush();
  return { root, cleanup };
}
const rowsOf = (root) => root.querySelectorAll('[role="treeitem"]');
const names = (root) => rowsOf(root).map((r) => r.querySelector('.gmr-name').textContent);
const row = (root, name) => rowsOf(root).find((r) => r.querySelector('.gmr-name').textContent === name);
const btn = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text);
const panelOf = (root) => root.querySelector('.gmr-panel');

test('page loads vocabulary and library, shows the map canvas, legend and the tree with Electronic open', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  assert.equal(root.querySelector('h1').textContent, 'Genres map rework');
  assert.ok(calls.some((c) => c.url.includes('/genres/vocabulary')) && calls.some((c) => c.url.endsWith('/library')));
  const canvas = root.querySelector('canvas');
  assert.equal(canvas.getAttribute('role'), 'img');
  assert.ok(canvas.getAttribute('aria-label').includes('Electronic'));
  assert.ok(root.querySelector('[aria-label="Legend"]').textContent.includes('Dashed ring: not in Discogs'));
  assert.equal(root.querySelector('[role="tree"]').getAttribute('aria-label'), 'Genre hierarchy');
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'drum and bass', 'house', 'Rock']);
  assert.equal(row(root, 'Electronic').getAttribute('aria-expanded'), 'true');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  assert.equal(row(root, 'breakbeat').getAttribute('aria-expanded'), null);
  assert.equal(row(root, 'house').getAttribute('aria-level'), '2');
  assert.equal(root.querySelector('[role="status"]').textContent, '2 genres, 7 styles');
  assert.equal(row(root, 'Electronic').querySelector('.gmr-count').textContent, '4');
  assert.equal(row(root, 'Rock').querySelector('.gmr-count').textContent, '1');
  assert.equal(row(root, 'breakbeat').querySelector('.gmr-count'), null);
  cleanup();
});

test('zoom controls exist and the outline toggle reports its state', async () => {
  mode = 'ok';
  const { root } = await mount();
  for (const l of ['Zoom in', 'Zoom out', 'Reset view']) assert.ok(root.querySelectorAll('button').some((b) => b.getAttribute('aria-label') === l), l);
  const toggle = btn(root, 'Outline');
  assert.equal(toggle.getAttribute('aria-controls'), 'gmr-outline');
  assert.ok(['true', 'false'].includes(toggle.getAttribute('aria-expanded')));
  toggle.click();
  const before = toggle.getAttribute('aria-expanded');
  toggle.click();
  assert.notEqual(toggle.getAttribute('aria-expanded'), before);
});

test('expand all, collapse all and the only-with-songs toggle', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(rowsOf(root).length, 9);
  const afro = row(root, 'afro house');
  assert.equal(afro.getAttribute('aria-level'), '3');
  assert.ok(afro.textContent.includes('not in Discogs'));
  assert.equal(afro.querySelector('.nodisc').getAttribute('aria-label'), 'Not in Discogs');
  assert.ok(row(root, 'rock and roll').textContent.includes('provisional'));
  assert.equal(row(root, 'deep house').querySelector('.nodisc'), null);
  btn(root, 'Only with songs').click();
  assert.equal(btn(root, 'Only with songs').getAttribute('aria-pressed'), 'true');
  assert.equal(names(root).includes('breakbeat'), false);
  btn(root, 'Collapse all').click();
  assert.deepEqual(names(root), ['Electronic', 'Rock']);
});

test('search finds a synonym, expands to it and clears with Escape', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Collapse all').click();
  const input = root.querySelector('input');
  input.value = 'dnb';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass']);
  assert.ok(row(root, 'drum and bass').textContent.includes('also called dnb'));
  input.value = 'qqq';
  fire(input, 'input');
  assert.equal(rowsOf(root).length, 0);
  assert.ok(root.textContent.includes('No genre or synonym matches'));
  fire(input, 'keydown', { key: 'Escape' });
  assert.deepEqual(names(root), ['Electronic', 'Rock']);
});

test('Enter in the search selects the first match and opens its details', async () => {
  mode = 'ok';
  const { root } = await mount();
  const input = root.querySelector('input');
  input.value = 'dnb';
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(panelOf(root).querySelector('h2').textContent, 'drum and bass');
  assert.equal(row(root, 'drum and bass').getAttribute('aria-selected'), 'true');
});

test('clicking a row opens the detail panel with chain, synonyms, flags and counts', async () => {
  mode = 'ok';
  const { root } = await mount();
  row(root, 'house').click();
  assert.equal(row(root, 'afro house').getAttribute('aria-level'), '3');
  assert.equal(panelOf(root).hidden, false);
  assert.equal(panelOf(root).querySelector('h2').textContent, 'house');
  assert.ok(panelOf(root).textContent.includes('Umbrella or standalone style (level 2)'));
  assert.ok(panelOf(root).textContent.includes('2 in your library (1 tagged exactly)'));
  row(root, 'afro house').click();
  assert.ok(panelOf(root).textContent.includes('No, a name added to this library'));
  assert.deepEqual(panelOf(root).querySelectorAll('.gm-chip').map((c) => c.textContent), ['Electronic', 'house']);
  row(root, 'Electronic').click();
  assert.ok(panelOf(root).textContent.includes('edm, dance music'));
  root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close details').click();
  assert.equal(root.querySelector('.gmr-panel').hidden, true);
});

test('also under chip jumps to the other parent; library button applies the genre filter', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  const chip = row(root, 'jungle').querySelector('.gmr-also');
  assert.equal(chip.textContent, 'also under breakbeat');
  assert.equal(chip.getAttribute('aria-label'), 'Also under breakbeat: jump to breakbeat');
  chip.click();
  assert.equal(panelOf(root).querySelector('h2').textContent, 'breakbeat');
  row(root, 'house').click();
  btn(root, 'Show 2 songs in Library').click();
  assert.equal(location.hash, '#/library');
  assert.ok(prefs.sel instanceof Set);
  row(root, 'breakbeat').click();
  assert.equal(btn(root, 'Show 0 songs in Library').disabled, true);
});

test('keyboard: arrows move, right expands, left collapses, Enter and Space toggle', async () => {
  mode = 'ok';
  const { root } = await mount();
  const tree = root.querySelector('[role="tree"]');
  const press = (key) => fire(tree, 'keydown', { key });
  const active = () => rowsOf(root).find((r) => r.getAttribute('tabindex') === '0').querySelector('.gmr-name').textContent;
  assert.equal(active(), 'Electronic');
  press('ArrowDown');
  assert.equal(active(), 'breakbeat');
  press('ArrowDown'); press('ArrowDown');
  assert.equal(active(), 'house');
  press('ArrowRight');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'true');
  press('ArrowRight');
  assert.equal(active(), 'afro house');
  press('ArrowLeft');
  assert.equal(active(), 'house');
  press('ArrowLeft');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  press('Enter');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'true');
  assert.equal(row(root, 'house').getAttribute('aria-selected'), 'true');
  press(' ');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  press('End');
  assert.equal(active(), 'Rock');
  press('Home');
  assert.equal(active(), 'Electronic');
});

test('failures: old server without levels, vocabulary down, library down', async () => {
  mode = 'old';
  let r = await mount();
  assert.ok(r.root.querySelector('[role="status"]').textContent.startsWith('Genre levels unavailable'));
  assert.equal(rowsOf(r.root).length, 0);
  mode = 'vocab-fail';
  r = await mount();
  assert.equal(r.root.querySelector('[role="status"]').textContent, 'Vocabulary unavailable');
  mode = 'lib-fail';
  r = await mount();
  assert.ok(r.root.querySelector('[role="status"]').textContent.includes('song counts unavailable'));
  assert.equal(rowsOf(r.root).length, 5);
  assert.equal(row(r.root, 'Electronic').querySelector('.gmr-count'), null);
  mode = 'fail';
  r = await mount();
  assert.equal(r.root.querySelector('[role="status"]').textContent, 'Vocabulary unavailable');
});

test('status badges show in the list and details and the status filter narrows the list', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(row(root, 'afro house').querySelector('.ok').getAttribute('aria-label'), 'Alex approved');
  assert.equal(row(root, 'deep house').querySelector('.q').getAttribute('aria-label'), 'Under question');
  assert.ok(row(root, 'afro house').querySelector('.nodisc'));
  row(root, 'deep house').click();
  assert.ok(root.querySelector('.gmr-panel').textContent.includes('Under question'));
  btn(root, 'approved').click();
  assert.equal(btn(root, 'approved').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'house', 'afro house']);
  btn(root, 'unreviewed').click();
  assert.ok(!names(root).includes('deep house') && !names(root).includes('afro house') && names(root).includes('jungle'));
  btn(root, 'all').click();
  assert.equal(names(root).includes('deep house'), true);
});

test('flavour chips have counts in their label and filter the list; clear resets', async () => {
  mode = 'ok';
  const { root } = await mount();
  const chip = (k) => root.querySelectorAll('[data-flavour]').find((b) => b.getAttribute('data-flavour') === k);
  assert.equal(chip('club').getAttribute('aria-label'), 'Club, 2 songs');
  assert.ok(chip('dark').getAttribute('title').includes('Menacing'));
  chip('dark').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house']);
  btn(root, 'question').click();
  assert.deepEqual(names(root), []);
  btn(root, 'all').click();
  assert.ok(row(root, 'house'));
  btn(root, 'Clear flavours').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'drum and bass', 'house', 'Rock']);
});

test('the whole-vocabulary toggle is a pressed button and persists through localStorage safely', async () => {
  mode = 'ok';
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { root } = await mount();
  const b = btn(root, 'Show whole vocabulary');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  b.click();
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(store.get('electrophone.genresReworkAll'), '1');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const second = await mount();
  const b2 = btn(second.root, 'Show whole vocabulary');
  assert.equal(b2.getAttribute('aria-pressed'), 'false');
  b2.click();
  assert.equal(b2.getAttribute('aria-pressed'), 'true');
  delete globalThis.localStorage;
});

test('Reload is a real button and the nav icon exists', async () => {
  mode = 'ok';
  const { root } = await mount();
  const b = btn(root, 'Reload');
  assert.ok(b && b.getAttribute('type') === 'button' && !b.disabled);
  assert.ok(ICONS.genresMapRework);
});
